/**
 * P4 — Transporte Range: download paralelo por partes (plano §15/§16).
 *
 * Herda o modo turbo atual (`src/cli/turbo.js`) SEM adaptacao/smart:
 *  - probe `Range: bytes=0-0` obrigatorio (206 + Content-Range com total).
 *  - sem Range -> lanca `RANGE_UNSUPPORTED` (strategy faz fallback p/ http).
 *  - valida `Content-Range` de cada parte (206 + offset correto).
 *  - detecta HTML/JSON no lugar de midia (`NOT_MEDIA`).
 *  - suporta limite de concorrencia (`concurrency`) — limites de recursos.
 *
 * P6.1 — Resume (secao 13):
 *  - `resume: true` (padrao): persiste `DownloadState` em sidecar
 *    (`<output>.resume.json`, escrita atomica em `src/core/resume.js`) e, se
 *    o recurso nao mudou (ETag/Last-Modified/tamanho), retoma apenas os
 *    chunks pendentes. Interrupcao mantem o parcial + sidecar.
 *  - Recurso mudou -> parcial descartado, download limpo (nunca concatena
 *    dados antigos).
 *  - URL assinada expirada (403/EXPIRED_URL no probe) -> reanalise unica via
 *    `onExpiredUrl` (decisao em `src/core/session.js`).
 *  - Rollback: `resume: false` (flag `--no-resume`) restaura o comportamento
 *    anterior (truncate + sem sidecar).
 *
 * P6.2 — Smart Turbo (secao 14, orientado por baseline):
 *  - `smartTurbo: true|objeto` ativa pool de workers DINAMICO: a cada janela
 *    (`windowMs`) o modulo `src/core/smart-turbo.js` mede throughput total,
 *    por-conexao e erros e decide subir/descer/hold a concurrency (rampa
 *    2->4->8->12, backoff por throttling/429/5xx, cooldown, limites min/max).
 *  - `smartTurbo: null|false` (rollback por config) mantem o pool FIXO antigo.
 *  - Reducao e gradual: workers excedentes terminam o chunk atual e param
 *    (sem cancelamento) — nao induz 403/429.
 *  - `onTurboDecision(decision)` expoe cada decisao (testes/instrumentacao).
 */

import fs from 'node:fs';
import { StreamGrabError, ForbiddenError, RateLimitError, NetworkError, CancelledError } from '../core/errors.js';
import { detectAcceptRanges, isNotMediaResponse } from './http.js';
import {
  defaultStatePath,
  createState,
  loadState,
  saveState,
  clearState,
  completedBytes,
} from '../core/resume.js';
import { resolveResumeSession } from '../core/session.js';
import { createSmartTurbo, normalizeSmartTurbo, isRetryableChunkError } from '../core/smart-turbo.js';

export const DEFAULT_RANGE_CHUNKS = 8;

/** Divide o arquivo em ranges contiguos cobrindo [0, total). */
function computeRanges(total, count) {
  const ranges = [];
  const chunkSize = Math.ceil(total / count);
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    if (start >= total) break;
    ranges.push({ start, end: Math.min(total - 1, start + chunkSize - 1) });
  }
  return ranges;
}

/**
 * Sonda o suporte a Range e retorna o tamanho total do arquivo.
 * @throws `RANGE_UNSUPPORTED` quando o servidor nao suporta Range/total.
 */
export async function probeRangeSupport(url, { headers = {}, signal, timeoutMs = 0 } = {}) {
  const probe = await detectAcceptRanges(url, { headers, signal, timeoutMs });
  if (!probe.acceptRanges) {
    throw new StreamGrabError('Servidor nao suporta download por partes (Range).', { code: 'RANGE_UNSUPPORTED' });
  }
  if (!probe.total) {
    throw new StreamGrabError('Servidor nao informou o tamanho total via Content-Range.', { code: 'RANGE_UNSUPPORTED' });
  }
  return { ok: true, total: probe.total, status: probe.status, etag: probe.etag, lastModified: probe.lastModified };
}

/**
 * Baixa `url` em partes paralelas via HTTP Range, escrevendo cada parte na
 * posicao correta do arquivo final.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {string} params.output
 * @param {object} [params.headers]
 * @param {AbortSignal} [params.signal]
 * @param {Function} [params.onProgress]
 * @param {number} [params.chunkCount=8]
 * @param {number} [params.concurrency] — limite de partes simultaneas (padrao: chunkCount).
 * @param {number} [params.timeoutMs] — 0 = sem timeout.
 * @param {boolean} [params.validateMedia=true]
 * @param {boolean|object} [params.smartTurbo] — P6.2: `true` (defaults) ou
 *   objeto de opcoes ativa o pool dinamico; `null`/`false` mantem o pool fixo.
 * @param {Function} [params.onTurboDecision] — P6.2: callback de cada decisao
 *   do Smart Turbo: `({ concurrency, action, reason, total, perConn, samples })`.
 * @param {boolean} [params.resume=true] — P6.1: resume por default; `false` (= --no-resume)
 *   restaura o comportamento antigo (truncate + sem sidecar).
 * @param {string} [params.statePath] — caminho do sidecar (default: `<output>.resume.json`).
 * @param {Function} [params.onExpiredUrl] — P6.1: reanalise de URL assinada
 *   expirada: `async ({ url, headers }) => ({ url })`. No maximo 1 chamada.
 * @param {Function} [params.onResume] — P6.1: callback informativo
 *   `({ action: 'fresh'|'resume'|'discard'|'reanalyze', reason, resumedBytes })`.
 * @returns {Promise<{ok: true, bytesDownloaded: number, totalBytes: number}>}
 * @throws `RANGE_UNSUPPORTED` (sem Range), `NOT_MEDIA`, Forbidden/RateLimit/Network etc.
 */
export async function downloadParallelRanges({
  url,
  output,
  headers = {},
  signal,
  onProgress,
  chunkCount = DEFAULT_RANGE_CHUNKS,
  concurrency,
  timeoutMs = 0,
  validateMedia = true,
  resume = true,
  smartTurbo,
  onTurboDecision,
  statePath,
  onExpiredUrl,
  onResume,
} = {}) {
  const count = Math.max(1, Math.floor(chunkCount));
  const sp = statePath || defaultStatePath(output);

  // --- P6.1: decisao de resume (probe + estado + reanalise de URL expirada) ---
  let probe;
  let state = null;
  let ranges = [];
  let fileMode = 'w';
  let resumedBytes = 0;

  if (resume) {
    let probeError = null;
    try {
      probe = await probeRangeSupport(url, { headers, signal, timeoutMs });
    } catch (err) {
      probeError = err;
    }
    const decision = await resolveResumeSession({
      state: loadState(sp),
      url,
      headers,
      probe,
      probeError,
      resolveFreshUrl: onExpiredUrl,
      probeRange: (u) => probeRangeSupport(u, { headers, signal, timeoutMs }),
      onReanalyze: (info) => onResume?.({ action: 'reanalyze', reason: info.reason, resumedBytes: 0 }),
    });
    if (decision.action === 'error') throw decision.error;
    url = decision.url || url;
    probe = decision.probe;

    if (decision.action === 'resume') {
      state = decision.state;
      ranges = state.chunks.filter((c) => !c.completed);
      resumedBytes = completedBytes(state);
      fileMode = 'r+';
      onResume?.({ action: 'resume', reason: decision.reason, resumedBytes });
      // Parcial ausente ou com tamanho divergente -> descarta e recomeca.
      const st = await fs.promises.stat(output).catch(() => null);
      if (!st || st.size !== probe.total) {
        await clearState(sp);
        state = null;
        ranges = computeRanges(probe.total, count);
        resumedBytes = 0;
        fileMode = 'w';
        onResume?.({ action: 'discard', reason: 'parcial ausente ou com tamanho divergente', resumedBytes: 0 });
      }
    } else {
      if (decision.state) await clearState(sp); // discard -> parcial descartado
      ranges = computeRanges(probe.total, count);
      onResume?.({ action: decision.action === 'discard' ? 'discard' : 'fresh', reason: decision.reason, resumedBytes: 0 });
    }
  } else {
    probe = await probeRangeSupport(url, { headers, signal, timeoutMs });
    ranges = computeRanges(probe.total, count);
  }

  const total = probe.total;
  const fh = await fs.promises.open(output, fileMode);
  if (fileMode === 'w') await fh.truncate(total);
  // P6.1: cria/persiste o sidecar somente depois que o arquivo final abriu.
  // Se o diretorio de saida nao existir, o erro de escrita (ENOENT) deve se
  // propagar como antes — o mkdir do saveState nao pode mascarar a falha.
  if (resume && !state) {
    state = createState({
      url,
      destination: output,
      totalSize: probe.total,
      etag: probe.etag,
      lastModified: probe.lastModified,
      chunks: ranges.map((r) => ({ ...r, downloaded: 0, completed: false })),
    });
    await saveState(sp, state);
  }
  const started = Date.now();
  let downloaded = resumedBytes;

  // P6.1: serializa as gravacoes do sidecar — gravar o mesmo .tmp em paralelo
  // poderia corromper o JSON (e degradar o resume para download limpo).
  let stateWriteChain = Promise.resolve();
  const persistState = () => {
    stateWriteChain = stateWriteChain.then(() => saveState(sp, state)).catch(() => {});
    return stateWriteChain;
  };

  const fetchChunk = async (chunk) => {
    const { start, end } = chunk;
    const controller = new AbortController();
    let readerRef = null;
    let abortReason = null; // 'signal' | 'timeout'
    const onAbort = () => {
      abortReason = 'signal';
      controller.abort();
      // P6.1: sem o cancel, um abort durante o streaming deixa o reader.read()
      // pendente para sempre (bug do undici) — o download travaria.
      readerRef?.cancel().catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            abortReason = 'timeout';
            controller.abort();
            readerRef?.cancel().catch(() => {});
          }, timeoutMs)
        : null;
    try {
      // P6.1: o undici pode ignorar o abort (request/stream em voo nao rejeita),
      // entao checamos o sinal explicitamente em pontos de controle.
      if (signal?.aborted) throw new CancelledError('Operacao cancelada.');
      const res = await fetch(url, {
        method: 'GET',
        headers: { ...headers, Range: `bytes=${start}-${end}` },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (signal?.aborted) throw new CancelledError('Operacao cancelada.');
      if (res.status === 403) throw new ForbiddenError('HTTP 403 ao baixar parte.', { status: 403 });
      if (res.status === 429) {
        const err = new RateLimitError('HTTP 429 ao baixar parte.', { status: 429 });
        err.retryAfter = res.headers.get('retry-after');
        throw err;
      }
      if (res.status >= 500) throw new NetworkError(`HTTP ${res.status} ao baixar parte.`, { status: res.status, retryable: true });
      if (res.status !== 206 || !res.body) {
        throw new StreamGrabError('Servidor nao respondeu 206 para a parte solicitada.', { code: 'RANGE_UNSUPPORTED' });
      }

      const contentRange = res.headers.get('content-range') || '';
      const m = /^bytes\s+(\d+)-\d+\/(\d+|\*)$/.exec(contentRange.trim());
      if (!m || Number(m[1]) !== start) {
        throw new StreamGrabError(`Content-Range invalido para a parte (${contentRange || 'ausente'}).`, {
          code: 'INVALID_CONTENT_RANGE',
        });
      }

      const contentType = res.headers.get('content-type') || '';
      if (validateMedia && isNotMediaResponse(contentType)) {
        throw new StreamGrabError(`Resposta nao e midia (${contentType || 'desconhecido'}).`, {
          code: 'NOT_MEDIA',
          status: res.status,
        });
      }

      const reader = res.body.getReader();
      readerRef = reader;
      let pos = start;
      for (;;) {
        const { done, value } = await reader.read();
        if (signal?.aborted) throw new CancelledError('Operacao cancelada.');
        if (done) break;
        if (value?.byteLength) {
          await fh.write(value, 0, value.byteLength, pos);
          pos += value.byteLength;
          downloaded += value.byteLength;
          const elapsed = Date.now() - started;
          const speed = elapsed > 0 ? Math.round((downloaded / elapsed) * 1000) : 0;
          const etaSeconds = speed > 0 && downloaded < total ? Math.round((total - downloaded) / speed) : null;
          onProgress?.({
            bytesDownloaded: downloaded,
            totalBytes: total,
            percent: Math.min(100, Math.round((downloaded / total) * 100)),
            speed,
            etaSeconds,
          });
        }
      }
      if (pos !== end + 1) {
        throw new StreamGrabError(`Parte incompleta (esperado ate ${end}, recebido ate ${pos - 1}).`, {
          code: 'INCOMPLETE_RANGE',
        });
      }
      // P6.1: chunk concluido -> persiste o progresso no state.
      if (resume && state) {
        const stored = state.chunks.find((c) => c.start === start && c.end === end);
        if (stored) {
          stored.completed = true;
          stored.downloaded = end - start + 1;
        }
        await persistState();
      }
    } catch (err) {
      // P6.1: salva o progresso parcial antes de propagar (permite retomar).
      if (resume && state) await persistState();
      if (abortReason === 'signal' || signal?.aborted) throw new CancelledError('Operacao cancelada.');
      if (abortReason === 'timeout' || err?.name === 'AbortError') {
        throw new NetworkError('Timeout ao baixar parte.', { retryable: true });
      }
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };

  // P6.2: o timer do Smart Turbo e limpo no finally mesmo em falha precoce.
  let turboTimer = null;
  try {
    // P6.2 — Smart Turbo: pool de workers DINAMICO (cresce/encolhe) quando
    // `smartTurbo` esta habilitado; `null`/`false` mantem o pool FIXO antigo
    // (rollback por config, sem mudanca de comportamento).
    const hardLimit =
      concurrency && concurrency > 0 ? Math.min(Math.floor(concurrency), ranges.length) : ranges.length;
    let turbo = null;
    if (smartTurbo && hardLimit >= 2) {
      const opts = normalizeSmartTurbo(smartTurbo);
      // Nunca acima do limite de recursos (concurrency) nem do nº de chunks.
      turbo = createSmartTurbo({
        ...opts,
        min: Math.min(opts.min, hardLimit),
        max: Math.min(opts.max, hardLimit),
        initial: Math.min(opts.initial, hardLimit),
      });
    }

    let desired = turbo ? turbo.getConcurrency() : hardLimit;
    let nextWorkerId = 0;
    let next = 0;
    let running = 0;
    let windowBytes = 0;
    let windowErrors = 0;
    let windowStart = Date.now();
    const workers = new Set();

    const sampleWindow = () => {
      const elapsed = Date.now() - windowStart;
      if (elapsed <= 0) return;
      const decision = turbo.sample({
        bytes: windowBytes,
        elapsedMs: elapsed,
        errors: windowErrors,
        concurrency: running,
      });
      windowBytes = 0;
      windowErrors = 0;
      windowStart = Date.now();
      onTurboDecision?.(decision);
    };

    const resizePool = () => {
      if (!turbo) return;
      desired = turbo.getConcurrency();
      // `running`/`next` so mudam em microtasks (workers async): calcular o
      // alvo ANTES do loop evita criar workers infinitamente num while sync.
      const toSpawn = Math.max(0, desired - running);
      for (let i = 0; i < toSpawn && next < ranges.length; i++) spawnWorker();
    };

    const spawnWorker = () => {
      const id = nextWorkerId++;
      const p = (async () => {
        running++;
        try {
          // `id < desired`: quando o turbo reduz, apenas os workers com id
          // acima do novo alvo param ao terminar o chunk atual (sem
          // cancelamento no meio do stream — nao induz 403/429).
          while (id < desired && next < ranges.length) {
            const range = ranges[next++];
            try {
              await fetchChunk(range);
              windowBytes += range.end - range.start + 1;
            } catch (err) {
              if (isRetryableChunkError(err)) windowErrors++;
              throw err;
            }
          }
        } finally {
          running--;
        }
      })();
      // `workers.delete(tracked)` roda em microtask encadeado (apos a
      // atribuicao de `p`): referenciar `p` dentro do corpo da IIFE async
      // lancaria TDZ quando o worker termina sem nenhum await (corpo sync).
      const tracked = p.finally(() => workers.delete(tracked));
      workers.add(tracked);
    };

    turboTimer = turbo
      ? setInterval(() => {
          sampleWindow();
          resizePool();
        }, Math.max(50, turbo.config().windowMs || 1200))
      : null;
    if (turboTimer) turboTimer.unref?.();

    if (turbo) {
      // Rampa inicial: workers do valor inicial; o timer cresce o pool.
      const toSpawn = Math.max(0, desired - running);
      for (let i = 0; i < toSpawn && next < ranges.length; i++) spawnWorker();
    } else {
      for (let i = 0; i < hardLimit; i++) spawnWorker();
    }
    // Aguarda TODOS os workers, inclusive os criados pelo timer do Smart
    // Turbo: o Set e dinamico (cada worker se remove ao terminar), entao o
    // loop espera cada geracao ate o pool esvaziar — evita fechar o fh antes
    // de um worker do timer terminar de escrever.
    while (workers.size > 0) {
      await Promise.all([...workers]);
    }
    if (resume && state) await clearState(sp);
    return { ok: true, bytesDownloaded: downloaded, totalBytes: total };
  } catch (err) {
    if (signal?.aborted) throw new CancelledError('Operacao cancelada.');
    throw err;
  } finally {
    clearInterval(turboTimer);
    await fh.close().catch(() => {});
  }
}

export default { downloadParallelRanges, probeRangeSupport, DEFAULT_RANGE_CHUNKS };
