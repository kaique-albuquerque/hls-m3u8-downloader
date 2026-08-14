/**
 * P2.5 — DownloadEngine (ciclo de vida do job) — src/core/engine.js
 *
 * Motor de execucao independente de CLI e Electron: recebe um job (ou URL),
 * conduz o ciclo de vida (queued -> analyzing -> preparing -> downloading ->
 * paused/merging -> completed/failed/cancelled) e emite os eventos da P2.3
 * (start/progress/speed/eta/pause/resume/complete/error/cancel) com payload
 * padronizado. A UI nunca parseia logs do FFmpeg: o progresso chega via
 * eventos deste engine.
 *
 * Criterios do plano (P2.5):
 *  - Cancelamento interrompe o download em andamento.
 *  - Erro e mapeado para a taxonomia de classes da P2.2 (errors.js).
 *  - Estado consistente em cada transicao (models.js valida a matriz).
 *  - NENHUMA referencia a console/readline/IPC.
 *
 * O transporte e injetavel via `executor` (mesmo contrato de
 * createDefaultExecutor): testes usam mocks deterministicos; a P2.6+ podera
 * plugar estrategias de transporte sem tocar no ciclo de vida.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEventBus, createProgressPayload } from './events.js';
import {
  createDownloadJob,
  transitionJob,
  serializeJob,
  isTerminalJobState,
} from './models.js';
import { classifyError, CancelledError } from './errors.js';
import { resolveSafeFilename, nextAvailableName } from './filenames.js';
import { estimateMuxSpace } from './disk.js';
import { getDefaultDownloadsDir, normalizeHeaders, DEFAULT_USER_AGENT, maskUrl } from '../utils.js';
import { resolveSourceAdapter, resolveSourceAdapterAsync } from '../source-adapters.js';
import { startDownload, startMuxDownload } from '../ffmpeg.js';
import { ffmpegService } from '../ffmpeg/service.js';
import { CurlImpersonateTransport } from '../transports/curl.js';
import { isMdstrmUrl } from '../mdstrm.js';
import { parsePlaylistText } from '../hls.js';
import { resolveTransportWithAutoInstall } from './mdstrm-routing.js';

const FALLBACK_TITLE = 'video';

function isAbortReasonPause(reason) {
  return reason === 'pause';
}

/**
 * Re-resolve a variante escolhida (selectedUrl) contra a análise mais recente
 * (variantes do master HLS). Os tokens de sessão do mdstrm mudam a cada
 * análise: o selectedUrl vindo da UI pode estar com tokens expirados quando o
 * engine roda (o renderer analisa, o usuário escolhe qualidade e enfileira —
 * e o engine RE-analisa a URL do player, obtendo tokens frescos). O match é
 * por pathname (estável entre refreshes), nunca por query string.
 * Retorna a URL absoluta fresca, ou null se nenhuma variante casar.
 */
export function resolveFreshVariant(selectedUrl, variants, baseUrl = '') {
  let selectedPath = null;
  try {
    selectedPath = new URL(selectedUrl).pathname;
  } catch {
    return null;
  }
  for (const variant of variants || []) {
    const uri = variant?.uri || variant?.url;
    if (!uri) continue;
    try {
      const absolute = new URL(uri, baseUrl || selectedUrl).toString();
      if (new URL(absolute).pathname === selectedPath) return absolute;
    } catch {
      /* ignora variante invalida */
    }
  }
  return null;
}

/**
 * Mascara uma URL para diagnóstico: alem dos parametros sensiveis do
 * maskUrl (access_token/sid/uid/token), oculta `ot` (one-time token do CDN
 * mdstrm, usado para autorizar a sessão). NUNCA logar tokens completos.
 */
function maskDiagUrl(value) {
  const masked = maskUrl(value);
  try {
    const u = new URL(masked);
    if (u.searchParams.has('ot')) u.searchParams.set('ot', '***');
    return u.toString();
  } catch {
    return masked;
  }
}

/**
 * Resolvedor de adapter padrao: mesma deteccao atual por URL/content-type
 * (forceYouTube usa o adapter youtube). Injetavel para testes sem rede.
 */
export async function defaultResolveAdapter(url, { headers = {}, forceYouTube = false } = {}) {
  if (forceYouTube) {
    return resolveSourceAdapter('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  }
  return resolveSourceAdapterAsync(url, headers);
}

/**
 * Executor padrao: adapters reais + FFmpeg + fetch nativo.
 * Contrato do executor:
 *  - analyze(adapter, { url, headers, auth }) -> analise crua do adapter
 *  - prepare(adapter, { url, analysis, selectedUrl, headers, auth }) -> PreparedDownload
 *  - run({ job, prepared, output, headers, mode, signal, onProgress }) ->
 *      { ok: true } | { ok: false, code, error, status, detail } |
 *      { paused: true } | { cancelled: true }
 */
export function createDefaultExecutor() {
  return {
    async analyze(adapter, { url, headers, auth }) {
      return adapter.analyze({ url, headers, auth });
    },

    async prepare(adapter, { url, analysis, selectedUrl, headers, auth }) {
      return adapter.prepareDownload({ url, analysis, selectedUrl, headers, auth });
    },

    async run({ job, prepared, output, headers, mode, signal, onProgress, atomic, onLog = () => {} }) {
      const sourceType = job._sourceType || job.meta?.sourceType || '';
      if (prepared.strategy === 'mux') {
        return runMuxDownload(prepared, output, headers, signal, onProgress);
      }
      // P12.1: multi-audio mux strategy
      if (prepared.strategy === 'mux-multi') {
        return runMuxMultiDownload(prepared, output, headers, signal, onProgress);
      }
      const url = prepared.downloadUrl || prepared.url;
      if (!url) {
        return { ok: false, code: 'DOWNLOAD_FAILED', error: 'Nenhuma URL de download preparada.' };
      }
      if (sourceType === 'hls' || sourceType === 'dash') {
        if (isMdstrmUrl(url) || isMdstrmUrl(job.url)) {
          // mdstrm: curl-impersonate quando instalado (CDNs que bloqueiam
          // TLS de navegador); FFmpeg direto caso contrario.
          const transport = await resolveTransportWithAutoInstall({
            headers,
            onLog,
          });
          if (transport) {
            const preferredVariantPath = safePathname(url);
            const curlEntryUrl = isMdstrmUrl(job.url) || isMdstrmPlayerUrl(job.url) ? job.url : url;
            const curlResult = await runCurlHlsDownload(
              curlEntryUrl,
              output,
              headers,
              signal,
              onProgress,
              transport,
              onLog,
              { preferredVariantPath }
            );
            if (curlResult) return curlResult;
          }
        }
        return runFfmpegDownload(url, output, headers, signal, onProgress, sourceType, mode, Number(job.meta?.durationMs || 0));
      }
      return runStreamDownload(url, output, headers, signal, onProgress, atomic);
    },
  };
}

// ---------------------------------------------------------------------------
// Execucoes concretas do executor padrao
// ---------------------------------------------------------------------------

function progressUpdate(downloaded, total, started) {
  const elapsed = (Date.now() - started) / 1000;
  const speed = elapsed > 0 ? downloaded / elapsed : 0;
  const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 1000) / 10) : 0;
  const etaSeconds = total > 0 && speed > 0 ? (total - downloaded) / speed : null;
  return { bytesDownloaded: downloaded, totalBytes: total, percent, speed, etaSeconds };
}

function estimateEtaFromPercent(percent, startedAtMs) {
  const pct = Number(percent) || 0;
  if (pct <= 0 || pct >= 100) return null;
  const elapsedSec = (Date.now() - startedAtMs) / 1000;
  if (elapsedSec <= 0) return null;
  const totalSec = elapsedSec / (pct / 100);
  const remaining = totalSec - elapsedSec;
  return remaining > 0 ? remaining : 0;
}

function abortOutcome(signal, ok = false) {
  if (!signal?.aborted) return ok ? { ok: true } : null;
  return isAbortReasonPause(signal.reason) ? { paused: true } : { cancelled: true };
}

async function runStreamDownload(url, output, headers, signal, onProgress, atomic) {
  const started = Date.now();
  let downloaded = 0;
  let total = 0;
  // P7: download atomico opt-in — grava em `.part` e renomeia apos validacao.
  let atomicFile = null;
  if (atomic && typeof atomic.createAtomicFile === 'function') {
    atomicFile = atomic.createAtomicFile({ dir: path.dirname(output), filename: path.basename(output) });
    output = atomicFile.partPath;
  }
  try {
    // P11.1: o fetch do Node nao envia User-Agent por padrao; varios CDNs/WAFs
    // rejeitam com 403 requisicoes sem UA. Mesmo padrao do CLI (FFmpeg sempre
    // envia um) e do probe de content-type. Header do usuario vence o default.
    const requestHeaders = normalizeHeaders({ 'User-Agent': DEFAULT_USER_AGENT, ...headers });
    const res = await fetch(url, { headers: requestHeaders, signal, redirect: 'follow' });
    if (!res.ok || !res.body) {
      return { ok: false, code: 'HTTP_ERROR', error: `HTTP ${res.status}`, status: res.status };
    }
    total = Number(res.headers.get('content-length') || 0);
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    const fh = await fs.promises.open(output, 'w');
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) {
          await fh.write(value, 0, value.byteLength);
          downloaded += value.byteLength;
          onProgress?.(progressUpdate(downloaded, total, started));
        }
      }
    } finally {
      await fh.close().catch(() => {});
    }
    if (signal?.aborted) {
      if (atomicFile) await atomicFile.abort().catch(() => {});
      return abortOutcome(signal);
    }
    if (atomicFile) {
      await atomicFile.commit().catch(() => {});
      if (!fs.existsSync(atomicFile.finalPath)) {
        return { ok: false, code: 'ATOMIC_COMMIT_FAILED', error: 'Falha ao finalizar arquivo.' };
      }
    }
    onProgress?.({ ...progressUpdate(downloaded, total, started), percent: 100 });
    return { ok: true };
  } catch (err) {
    if (atomicFile) await atomicFile.abort().catch(() => {});
    if (signal?.aborted) return abortOutcome(signal);
    return { ok: false, code: err?.code || 'DOWNLOAD_FAILED', error: err.message, status: err?.status };
  }
}

function makeFfmpegProgress(onProgress, durationMs) {
  let outMs = 0;
  let totalSize = 0;
  let startedAtMs = 0;
  return ({ key, value }) => {
    if (!startedAtMs) startedAtMs = Date.now();
    if (key === 'out_time_us') outMs = Number(value) / 1000;
    else if (key === 'out_time_ms') outMs = Number(value);
    else if (key === 'total_size') totalSize = Number(value);
    const percent = durationMs > 0 ? Math.min(100, Math.round((outMs / durationMs) * 1000) / 10) : 0;
    const elapsedSec = startedAtMs > 0 ? (Date.now() - startedAtMs) / 1000 : 0;
    const speed = elapsedSec > 0 ? totalSize / elapsedSec : 0;
    const etaSeconds =
      durationMs > 0 && outMs > 0
        ? Math.max(0, (durationMs - outMs) / 1000)
        : estimateEtaFromPercent(percent, startedAtMs);
    onProgress({ bytesDownloaded: totalSize, totalBytes: 0, percent, speed, etaSeconds });
  };
}

/** Baixa via FFmpeg (HLS/DASH). `durationMs` usado para percentual aproximado. */
async function runFfmpegDownload(url, output, headers, signal, onProgress, sourceType, modeIndex = 0, durationMs = 0) {
  const extraArgs = sourceType === 'hls' ? ['-allowed_extensions', 'ALL'] : [];
  const { promise, stop } = startDownload({
    url,
    output,
    headers,
    modeIndex,
    extraArgs,
    onProgress: makeFfmpegProgress(onProgress, durationMs),
  });
  const onAbort = () => stop();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const result = await promise;
    if (signal?.aborted) return abortOutcome(signal);
    if (result.ok) return { ok: true };
    if (result.interrupted) return { paused: true };
    return {
      ok: false,
      code: 'FFMPEG_FAILED',
      error: `ffmpeg saiu com codigo ${result.code ?? 'desconhecido'}`,
      detail: String(result.stderr || '').slice(-2000),
    };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

function segmentProgressToEngine({ done, total, totalBytes, failed }, startedAtMs = Date.now()) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 1000) / 10) : 0;
  const elapsedSec = (Date.now() - startedAtMs) / 1000;
  const speed = elapsedSec > 0 ? totalBytes / elapsedSec : 0;
  const etaSeconds = estimateEtaFromPercent(percent, startedAtMs);
  return { bytesDownloaded: totalBytes, totalBytes: 0, percent, speed, etaSeconds, failed };
}

/**
 * Download HLS via curl-impersonate (playlist + segmentos com TLS de navegador)
 * + mux local com FFmpeg. Espelha o fluxo do CLI (cli/curl-flow.js) que funciona
 * em CDNs que rejeitam o TLS do FFmpeg (ex.: mdstrm). Retorna null quando o
 * curl-impersonate não está instalado (o chamador cai no caminho FFmpeg legado).
 * `transport` opcional: evita resolver duas vezes (o chamador ja resolveu para
 * o diagnostico). `onLog` opcional: callback de diagnostico sanitizado.
 */
function safePathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function isMdstrmPlayerUrl(url) {
  return /^https?:\/\/mdstrm\.com\/video\/[a-f0-9]+\.m3u8/i.test(String(url || ''));
}

async function runCurlHlsDownload(
  url,
  output,
  headers,
  signal,
  onProgress,
  transport = null,
  onLog = () => {},
  { preferredVariantPath = '' } = {}
) {
  if (!transport) {
    transport = CurlImpersonateTransport.resolve({ headers });
    if (!transport) return null;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-curl-'));
  const segmentStartedAtMs = Date.now();
  try {
    // Target playlist (media or master). `url` is already the prepared downloadUrl:
    // when the UI chose quality, it's the absolute variant; otherwise,
    // it's the original URL (which may be a master).
    let mediaText;
    let mediaBase;
    const { text: firstText, finalUrl: firstFinal } = await transport.getText(url, { signal });
    const info = parsePlaylistText(firstText, firstFinal || url);
    if (info.kind === 'master' && info.variants.length > 0) {
      const matched = preferredVariantPath
        ? info.variants.find((variant) => safePathname(new URL(variant.uri, info.baseUrl || firstFinal || url).toString()) === preferredVariantPath)
        : null;
      const picked = matched || info.variants[0];
      const variantUrl = new URL(picked.uri, info.baseUrl || firstFinal || url).toString();
      ({ text: mediaText, finalUrl: mediaBase } = await transport.getText(variantUrl, { signal }));
      mediaBase = mediaBase || variantUrl;
    } else {
      mediaText = firstText;
      mediaBase = firstFinal || url;
    }

    const result = await transport.downloadSegments({
      mediaText,
      mediaBase,
      tmpDir,
      signal,
      onProgress: (p) => onProgress?.(segmentProgressToEngine(p, segmentStartedAtMs)),
    });
    if (!result.ok) {
      const reason = result.error === 'interrupted' ? 'interrupted' : `segmentos (${result.error})`;
      if (signal?.aborted) return abortOutcome(signal);
      return { ok: false, code: 'CURL_SEGMENTS_FAILED', error: `Falha ao baixar ${reason}.` };
    }
    if (signal?.aborted) return abortOutcome(signal);

    onProgress?.({ stage: 'merging', percent: 90, message: 'Juntando segmentos com FFmpeg' });
    const { promise, stop } = startDownload({
      url: result.localPlaylist,
      output,
      headers: {},
      modeIndex: 0,
      extraArgs: result.extraArgs,
      onProgress: makeFfmpegProgress((u) => onProgress?.({ ...u, stage: 'merging' }), 0),
    });
    const onAbort = () => stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const muxResult = await promise;
      if (signal?.aborted) return abortOutcome(signal);
      if (muxResult.ok) {
        onProgress?.({ ...progressUpdate(0, 0, Date.now()), percent: 100, stage: 'merging' });
        return { ok: true };
      }
      return {
        ok: false,
        code: 'FFMPEG_FAILED',
        error: `ffmpeg saiu com codigo ${muxResult.code ?? 'desconhecido'}`,
        detail: String(muxResult.stderr || '').slice(-2000),
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  } catch (err) {
    if (signal?.aborted) return abortOutcome(signal);
    return { ok: false, code: err?.code || 'CURL_DOWNLOAD_FAILED', error: err.message, status: err?.status };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  }
}

async function runMuxDownload(prepared, output, headers, signal, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mux-'));
  const videoTmp = path.join(tmpDir, 'video.mp4');
  const audioTmp = path.join(tmpDir, 'audio.m4a');
  try {
    const [video, audio] = await Promise.all([
      runStreamDownload(prepared.videoUrl, videoTmp, headers, signal, (u) => onProgress({ ...u, stage: 'downloading' })),
      runStreamDownload(prepared.audioUrl, audioTmp, headers, signal, (u) => onProgress({ ...u, stage: 'downloading' })),
    ]);
    if (signal?.aborted) return abortOutcome(signal);
    if (!video.ok || !audio.ok) {
      return { ok: false, code: 'MUX_DOWNLOAD_FAILED', error: 'Falha ao baixar video/audio separados.' };
    }
    onProgress?.({ stage: 'merging', percent: 90, message: 'Juntando video e audio com FFmpeg' });
    const { promise, stop } = startMuxDownload({
      videoInput: videoTmp,
      audioInput: audioTmp,
      output,
      onProgress: makeFfmpegProgress((u) => onProgress({ ...u, stage: 'merging' }), 0),
    });
    const onAbort = () => stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await promise;
      if (signal?.aborted) return abortOutcome(signal);
      if (result.ok) return { ok: true };
      return { ok: false, code: 'MUX_FAILED', error: `ffmpeg mux saiu com codigo ${result.code ?? 'desconhecido'}` };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  }
}

// ---------------------------------------------------------------------------
// P12.1: Multi-audio mux download
// ---------------------------------------------------------------------------

/**
 * Downloads video + N audio tracks and muxes with FFmpeg.
 * Each audio track becomes a separate FFmpeg input.
 * prepared shape: { strategy: 'mux-multi', videoUrl, audioUrls[], audioLabels[], audioLanguages[] }
 */
async function runMuxMultiDownload(prepared, output, headers, signal, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mux-multi-'));
  try {
    // 1) Download video
    const videoTmp = path.join(tmpDir, 'video.mp4');
    const videoResult = await runStreamDownload(
      prepared.videoUrl, videoTmp, headers, signal,
      (u) => onProgress({ ...u, stage: 'downloading', message: 'Baixando video' }),
    );
    if (!videoResult.ok) return videoResult;
    if (signal?.aborted) return abortOutcome(signal);

    // 2) Download each audio track in parallel
    const audioTmps = [];
    const audioUrls = prepared.audioUrls || [];
    for (let i = 0; i < audioUrls.length; i++) {
      const audioTmp = path.join(tmpDir, `audio_${i}.m4a`);
      const label = prepared.audioLabels?.[i] || prepared.audioLanguages?.[i] || `audio ${i + 1}`;
      const result = await runStreamDownload(
        audioUrls[i], audioTmp, headers, signal,
        (u) => onProgress({ ...u, stage: 'downloading', message: `Baixando audio ${i + 1}/${audioUrls.length} (${label})` }),
      );
      if (!result.ok) return result;
      if (signal?.aborted) return abortOutcome(signal);
      audioTmps.push(audioTmp);
    }

    // 3) Mux with FFmpeg: -i video -i audio0 -i audio1 ... -map 0:v -map 1:a -map 2:a ...
    onProgress?.({ stage: 'merging', percent: 90, message: 'Juntando video + audios com FFmpeg' });

    const ffmpegArgs = [
      '-hide_banner', '-loglevel', 'error', '-nostats', '-y',
      '-i', videoTmp,
    ];

    // Add audio inputs
    for (const audioTmp of audioTmps) {
      ffmpegArgs.push('-i', audioTmp);
    }

    ffmpegArgs.push('-progress', 'pipe:1');

    // Maps: video from input 0, audio from each subsequent input
    ffmpegArgs.push('-map', '0:v:0');
    for (let i = 0; i < audioTmps.length; i++) {
      ffmpegArgs.push('-map', `${i + 1}:a:0`);
    }

    // Copy all streams
    ffmpegArgs.push('-c:v', 'copy', '-c:a', 'copy');

    // Metadata for each audio track
    for (let i = 0; i < audioTmps.length; i++) {
      const lang = prepared.audioLanguages?.[i] || 'und';
      const label = prepared.audioLabels?.[i] || '';
      ffmpegArgs.push('-metadata:s:a:' + i, `language=${lang}`);
      if (label) ffmpegArgs.push('-metadata:s:a:' + i, `title=${label}`);
    }

    ffmpegArgs.push('-movflags', '+faststart', output);

    const { promise, stop } = ffmpegService.run({
      args: ffmpegArgs,
      onProgress: makeFfmpegProgress((u) => onProgress({ ...u, stage: 'merging' }), 0),
    });

    const onAbort = () => stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await promise;
      if (signal?.aborted) return abortOutcome(signal);
      if (result.ok) return { ok: true };
      return {
        ok: false,
        code: 'MUX_MULTI_FAILED',
        error: `ffmpeg mux-multi saiu com codigo ${result.code ?? 'desconhecido'}`,
        detail: String(result.stderr || '').slice(-2000),
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// DownloadEngine
// ---------------------------------------------------------------------------

/**
 * Motor de ciclo de vida de downloads.
 *
 * Opcoes:
 *  - events: event bus da P2.3 (default: novo)
 *  - executor: transporte injetavel (default: createDefaultExecutor())
 *  - progressThrottleMs: intervalo minimo entre eventos de progresso
 *  - resolveAdapter: deteccao de fonte (default: defaultResolveAdapter)
 */
export class DownloadEngine {
  constructor({ events = createEventBus(), executor = createDefaultExecutor(), progressThrottleMs = 80, resolveAdapter = defaultResolveAdapter, settings = null, disk = null, history = null, atomic = null } = {}) {
    this.events = events;
    this.executor = executor;
    this.progressThrottleMs = progressThrottleMs;
    this.resolveAdapter = resolveAdapter;
    // P7 — optional collaborators (integration without changing default behavior):
    this.settings = settings; // store com get('defaultDir')
    this.disk = disk; // { check({ dir, requiredBytes, extraBytes }) }
    this.history = history; // { add(entry) }
    this.atomic = atomic; // { createAtomicFile({ dir, filename }) }
    this._jobs = new Map(); // id -> job (objeto de dominio, nao serializado)
    this._active = new Map(); // id -> { attempt: AbortController, resume: fn|null }
  }

  // -- eventos --------------------------------------------------------------

  on(name, handler) {
    return this.events.on(name, handler);
  }

  once(name, handler) {
    return this.events.once(name, handler);
  }

  off(name, handler) {
    return this.events.off(name, handler);
  }

  _emit(name, payload) {
    this.events.emit(name, createProgressPayload(payload));
  }

  // -- fila -----------------------------------------------------------------

  _nextId() {
    // P1.2: IDs com timestamp+random para evitar colisao apos crash recovery.
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `job-${ts}-${rand}`;
  }

  getJob(id) {
    const job = this._jobs.get(String(id));
    return job ? serializeJob(job) : null;
  }

  getQueue() {
    return [...this._jobs.values()].filter((j) => !isTerminalJobState(j.state)).map(serializeJob);
  }

  getHistory() {
    return [...this._jobs.values()].filter((j) => isTerminalJobState(j.state)).map(serializeJob);
  }

  /** Remove um job TERMINAL (completed/failed/cancelled). Job ativo lança. */
  remove(id) {
    const job = this._jobs.get(String(id));
    if (!job) {
      const err = new Error(`Job nao encontrado: ${id}`);
      err.code = 'JOB_NOT_FOUND';
      throw err;
    }
    if (!isTerminalJobState(job.state)) {
      const err = new Error(`Job ${id} ainda nao terminou (${job.state}).`);
      err.code = 'JOB_ACTIVE';
      throw err;
    }
    this._jobs.delete(job.id);
    return true;
  }

  /** Cria um job `queued` na fila. Retorna o job serializado. */
  enqueue(url, { id, title = '', meta = {} } = {}) {
    const job = createDownloadJob({ id: id || this._nextId(), url, title, meta });
    this._jobs.set(job.id, job);
    return serializeJob(job);
  }

  // -- execucao -------------------------------------------------------------

  /**
   * Executa o ciclo de vida do job emitindo eventos. `target` pode ser uma
   * URL (cria job novo) ou o id de um job enfileirado.
   */
  async run(target, opts = {}) {
    let job;
    const existing = typeof target === 'string' ? this._jobs.get(target) : null;
    if (existing) {
      if (isTerminalJobState(existing.state)) {
        const err = new Error(`Job ${existing.id} ja finalizado (${existing.state}).`);
        err.code = 'JOB_ALREADY_FINAL';
        throw err;
      }
      if (existing.state !== 'queued') {
        const err = new Error(`Job ${existing.id} ja esta em andamento (${existing.state}).`);
        err.code = 'JOB_ALREADY_RUNNING';
        throw err;
      }
      job = existing;
    } else {
      job = createDownloadJob({ id: this._nextId(), url: target, title: opts.title, meta: opts.meta });
      this._jobs.set(job.id, job);
    }

    await this._runJob(job, opts);
    return serializeJob(job);
  }

  async _runJob(job, { selectedUrl, destination, headers = {}, auth = {}, forceYouTube = false, mode, audioLanguage, allAudio } = {}) {
    try {
      const { adapter, raw } = await this._analyze(job, { selectedUrl, headers, auth, forceYouTube });
      const { prepared } = await this._prepare(job, adapter, raw, { selectedUrl, destination, headers, auth, audioLanguage, allAudio });
      const outputPath = this._resolveOutput(job, prepared, destination);
      job.meta.output = outputPath;
      await this._downloadLoop(job, prepared, { headers, mode });
      this._complete(job);
    } catch (err) {
      this._handleFailure(job, err);
    } finally {
      this._active.delete(job.id);
    }
  }

  // -- decomposicao de _runJob -----------------------------------------------

  /** Fase 1: detectar adapter + analise + fresh variant. */
  async _analyze(job, { selectedUrl, headers, auth, forceYouTube }) {
    transitionJob(job, 'analyzing');
    this._emit('start', { jobId: job.id, stage: 'analyzing', message: `Analisando ${maskDiagUrl(job.url)}` });

    // Sprint 4.4: log recovered jobs (crash recovery with fresh tokens)
    if (job.meta?.recovered) {
      this._emit('log', { jobId: job.id, message: '[recovery] Download recuperado apos crash — re-analisando com tokens frescos' });
    }

    const adapter = await this.resolveAdapter(job.url, { headers, auth, forceYouTube });
    if (adapter.id === 'unknown') {
      const err = new Error('Fonte nao suportada.');
      err.code = 'UNSUPPORTED_SOURCE';
      throw err;
    }
    job._sourceType = adapter.id;
    job.meta.sourceType = adapter.id;

    let raw;
    try {
      raw = await this.executor.analyze(adapter, { url: job.url, headers, auth });
    } catch (err) {
      if (this._active.get(job.id)?.attempt?.signal.aborted) throw new CancelledError('Analise cancelada.');
      throw err;
    }
    job.title = raw?.title || job.title;
    job._analysis = raw;

    // P11.1 mdstrm: re-resolve variante por pathname (tokens podem expirar).
    if (selectedUrl && raw?.kind === 'master' && Array.isArray(raw.variants) && raw.variants.length > 0) {
      const fresh = resolveFreshVariant(selectedUrl, raw.variants, raw.baseUrl);
      if (fresh) {
        this._emit('log', {
          jobId: job.id,
          message: `[mdstrm] variante re-resolvida com tokens frescos: ${maskDiagUrl(fresh)} (era ${maskDiagUrl(selectedUrl)})`,
        });
        selectedUrl = fresh;
      }
    }

    return { adapter, raw };
  }

  /** Fase 2: preparar download + checar disco + resolver destino. */
  async _prepare(job, adapter, raw, { selectedUrl, destination, headers, auth, audioLanguage, allAudio }) {
    transitionJob(job, 'preparing');
    this._emit('progress', { jobId: job.id, stage: 'preparing', message: 'Preparando download' });

    const prepared = await this.executor.prepare(adapter, { url: job.url, analysis: raw, selectedUrl, headers, auth, audioLanguage, allAudio });
    if (this._isAborted(job)) throw new CancelledError('Download cancelado.');
    job._prepared = prepared;
    job.meta.totalBytes = Number(prepared.totalBytes || 0);
    job.meta.durationMs = Number(prepared.durationMs || 0);

    // espaco em disco antes de comecar (incl. temporario extra p/ mux)
    const dir = destination || this.settings?.get?.('defaultDir') || getDefaultDownloadsDir();
    if (this.disk && job.meta.totalBytes > 0) {
      const extra = prepared.strategy === 'mux' ? Math.max(0, estimateMuxSpace(job.meta.totalBytes) - job.meta.totalBytes) : 0;
      await this.disk.check({ dir, requiredBytes: job.meta.totalBytes, extraBytes: extra });
    }

    return { prepared };
  }

  /** Resolve diretorio de saida, nome do arquivo e espaco em disco. */
  _resolveOutput(job, prepared, destination) {
    const dir = destination || this.settings?.get?.('defaultDir') || getDefaultDownloadsDir();
    // espaco em disco: checagem async feita no _prepare (mantida aqui por
    // compatibilidade com o fluxo antigo; o disk.check e chamado antes).
    const base = job.meta?.filename || job.title || FALLBACK_TITLE;
    const ext = this._extensionFor(prepared);
    let output = resolveSafeFilename(base, { dir, ext });
    output = nextAvailableName(output);
    return output;
  }

  /** Fase 3: loop de download com pausa/retomada. */
  async _downloadLoop(job, prepared, { headers, mode }) {
    transitionJob(job, 'downloading');
    job._startedAt = Date.now();
    const onProgress = this._makeProgress(job);

    for (;;) {
      if (job._cancelRequested) throw new CancelledError('Download cancelado.');
      if (job.state === 'paused') {
        transitionJob(job, 'downloading');
        this._emit('resume', { jobId: job.id, stage: 'downloading', message: 'Retomando download' });
      }
      const attempt = new AbortController();
      this._active.set(job.id, { attempt, resume: null });

      const result = await this.executor.run({
        job,
        prepared,
        output: job.meta.output,
        headers,
        mode,
        signal: attempt.signal,
        onProgress,
        atomic: this.atomic,
        onLog: (message) => this._emit('log', { jobId: job.id, message }),
      });

      if (result?.paused) {
        transitionJob(job, 'paused');
        this._emit('pause', { jobId: job.id, stage: 'paused', message: 'Download pausado' });
        await new Promise((resolve) => {
          const entry = this._active.get(job.id);
          if (entry) entry.resume = resolve;
        });
        continue;
      }
      if (result?.cancelled) throw new CancelledError('Download cancelado.');
      if (!result?.ok) {
        const err = new Error(result?.error || 'Falha no download.');
        err.code = result?.code || 'DOWNLOAD_FAILED';
        err.status = result?.status || 0;
        err.detail = result?.detail || '';
        throw err;
      }
      break;
    }
  }

  /** Fase 4: transicao para completed + historico + evento. */
  _complete(job) {
    transitionJob(job, 'completed');
    job._downloadedAt = Date.now();
    this._recordHistory(job, { status: 'completed' });
    this._emit('complete', {
      jobId: job.id,
      stage: 'completed',
      percent: 100,
      message: `Download concluido: ${job.meta.output}`,
      output: job.meta.output || '',
    });
  }

  /** Tratamento centralizado de falhas (cancelado vs erro classificado). */
  _handleFailure(job, err) {
    const classified = classifyError(err);
    if (classified instanceof CancelledError) {
      transitionJob(job, 'cancelled', { error: classified });
      this._cleanupPartial(job.meta.output);
      this._recordHistory(job, { status: 'cancelled' });
      this._emit('cancel', { jobId: job.id, stage: 'cancelled', message: 'Download cancelado.' });
      return;
    }
    transitionJob(job, 'failed', { error: classified });
    this._cleanupPartial(job.meta.output);
    this._recordHistory(job, { status: 'failed' });
    this._emit('error', {
      jobId: job.id,
      stage: 'failed',
      message: classified.friendlyMessage || classified.message,
      code: classified.code || '',
      suggestedAction: classified.suggestedAction || '',
      detail: classified.detail || '',
      status: classified.status || 0,
    });
    throw classified;
  }

  /** Registra o download no historico (se fornecido); nunca derruba o fluxo. */
  _recordHistory(job, { status }) {
    if (!this.history || typeof this.history.add !== 'function') return;
    try {
      let size = 0;
      const out = job.meta?.output;
      if (out && fs.existsSync(out)) {
        try {
          size = fs.statSync(out).size;
        } catch {
          size = 0;
        }
      }
      this.history.add({
        title: job.title || job.url,
        url: job.url,
        provider: job._sourceType || job.meta?.sourceType || '',
        format: job.meta?.format || job.meta?.chosenFormat || '',
        destination: job.meta?.output || '',
        status,
        size,
        durationMs: job._startedAt ? Math.max(0, Date.now() - job._startedAt) : 0,
      });
    } catch {
      /* historico nunca derruba o download */
    }
  }

  _isAborted(job) {
    return Boolean(this._active.get(job.id)?.attempt?.signal.aborted);
  }

  _extensionFor(prepared) {
    if (prepared.strategy === 'mux') return '.mp4';
    const url = String(prepared.downloadUrl || prepared.url || '');
    const m = /\.(mp4|webm|mkv|mov|m4a|mp3)(\?|$)/i.exec(url);
    return m ? `.${m[1].toLowerCase()}` : '.mp4';
  }

  _makeProgress(job) {
    let lastEmit = 0;
    return (update = {}) => {
      const now = Date.now();
      if (now - lastEmit < this.progressThrottleMs) return;
      lastEmit = now;
      const clean = {};
      for (const [k, v] of Object.entries(update)) {
        if (v !== undefined) clean[k] = v;
      }
      const payload = createProgressPayload({ ...clean, jobId: job.id, stage: clean.stage || 'downloading' });
      this._emit('progress', payload);
      if (clean.speed != null) this._emit('speed', { jobId: job.id, speed: clean.speed });
      if (clean.etaSeconds != null) this._emit('eta', { jobId: job.id, etaSeconds: clean.etaSeconds });
    };
  }

  _cleanupPartial(output) {
    try {
      if (output && fs.existsSync(output)) fs.unlinkSync(output);
    } catch {
      /* ignora */
    }
  }

  // -- controle -------------------------------------------------------------

  /** Pausa um job em `downloading`. Idempotente (no-op se nao estiver rodando). */
  pause(id) {
    const job = this._jobs.get(String(id));
    if (!job) {
      const err = new Error(`Job nao encontrado: ${id}`);
      err.code = 'JOB_NOT_FOUND';
      throw err;
    }
    if (job.state === 'downloading') {
      this._active.get(job.id)?.attempt.abort('pause');
    }
    return serializeJob(job);
  }

  /** Retoma um job pausado. Idempotente. */
  resume(id) {
    const job = this._jobs.get(String(id));
    if (!job) {
      const err = new Error(`Job nao encontrado: ${id}`);
      err.code = 'JOB_NOT_FOUND';
      throw err;
    }
    if (job.state === 'paused') {
      this._active.get(job.id)?.resume?.();
    }
    return serializeJob(job);
  }

  /** Cancela um job ativo/enfileirado. Idempotente. */
  cancel(id) {
    const job = this._jobs.get(String(id));
    if (!job) {
      const err = new Error(`Job nao encontrado: ${id}`);
      err.code = 'JOB_NOT_FOUND';
      throw err;
    }
    if (isTerminalJobState(job.state)) return serializeJob(job);
    job._cancelRequested = true;
    const entry = this._active.get(job.id);
    if (job.state === 'queued') {
      transitionJob(job, 'cancelled', { error: new CancelledError('Download cancelado.') });
      this._emit('cancel', { jobId: job.id, stage: 'cancelled', message: 'Download cancelado.' });
    } else if (job.state === 'paused') {
      entry?.resume?.(); // acorda o loop; o loop ve _cancelRequested e encerra
    } else {
      entry?.attempt.abort('cancel');
    }
    return serializeJob(job);
  }

  /** Aborta todos os downloads ativos (cancelamento global). */
  dispose() {
    for (const [, entry] of this._active) {
      entry.attempt.abort('cancel');
      entry.resume?.();
    }
    this._active.clear();
  }
}

/** Factory de conveniencia. */
export function createDownloadEngine(opts) {
  return new DownloadEngine(opts);
}

export default DownloadEngine;
