/**
 * P4 — Transporte Range: download paralelo por partes (plano §15/§16).
 *
 * Herda o modo turbo atual (`src/cli/turbo.js`) SEM adaptacao/smart:
 *  - probe `Range: bytes=0-0` obrigatorio (206 + Content-Range com total).
 *  - sem Range -> lanca `RANGE_UNSUPPORTED` (strategy faz fallback p/ http).
 *  - valida `Content-Range` de cada parte (206 + offset correto).
 *  - detecta HTML/JSON no lugar de midia (`NOT_MEDIA`).
 *  - suporta limite de concorrencia (`concurrency`) — limites de recursos.
 */

import fs from 'node:fs';
import { StreamGrabError, ForbiddenError, RateLimitError, NetworkError, CancelledError } from '../core/errors.js';
import { detectAcceptRanges, isNotMediaResponse } from './http.js';

export const DEFAULT_RANGE_CHUNKS = 8;

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
  return { ok: true, total: probe.total, status: probe.status };
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
} = {}) {
  const probe = await probeRangeSupport(url, { headers, signal, timeoutMs });
  const total = probe.total;
  const count = Math.max(1, Math.floor(chunkCount));
  const chunkSize = Math.ceil(total / count);

  const ranges = [];
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    if (start >= total) break;
    ranges.push({ start, end: Math.min(total - 1, start + chunkSize - 1) });
  }

  const fh = await fs.promises.open(output, 'w');
  await fh.truncate(total);
  const started = Date.now();
  let downloaded = 0;

  const fetchChunk = async ({ start, end }) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { ...headers, Range: `bytes=${start}-${end}` },
        redirect: 'follow',
        signal: controller.signal,
      });
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
      let pos = start;
      for (;;) {
        const { done, value } = await reader.read();
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
    } catch (err) {
      if (signal?.aborted) throw new CancelledError('Operacao cancelada.');
      if (err?.name === 'AbortError') throw new NetworkError('Timeout ao baixar parte.', { retryable: true });
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };

  try {
    const limit = concurrency && concurrency > 0 ? Math.min(Math.floor(concurrency), ranges.length) : ranges.length;
    const workers = [];
    let next = 0;
    const worker = async () => {
      while (next < ranges.length) {
        const range = ranges[next++];
        await fetchChunk(range);
      }
    };
    for (let i = 0; i < limit; i++) workers.push(worker());
    await Promise.all(workers);
    return { ok: true, bytesDownloaded: downloaded, totalBytes: total };
  } catch (err) {
    if (signal?.aborted) throw new CancelledError('Operacao cancelada.');
    throw err;
  } finally {
    await fh.close().catch(() => {});
  }
}

export default { downloadParallelRanges, probeRangeSupport, DEFAULT_RANGE_CHUNKS };
