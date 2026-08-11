/**
 * P2.1 — Domain Models (src/core/models.js)
 *
 * Modelos normalizados do StreamGrab: MediaInfo, Format e DownloadJob,
 * com os estados do ciclo de vida do job. Sem logica de download.
 *
 * Contratos:
 *  - Format: shape normalizado espelhando os formatos dos adapters existentes
 *    (ytdlp/youtube: formatId, url, container, codecs, qualityLabel, bitrate,
 *    width, height, fps, hasVideo, hasAudio, contentLength).
 *  - MediaInfo: shape da analise (title, durationSeconds, sourceType, provider,
 *    formats, variants, progressiveFormats, adaptiveVideoFormats, adaptiveAudioFormats).
 *  - DownloadJob: ciclo de vida queued -> analyzing -> preparing -> downloading
 *    -> (paused | merging) -> completed/failed/cancelled, com historico de
 *    transicoes e serializacao limpa (sem campos circulares).
 */

// ---------------------------------------------------------------------------
// Estados do job (architect.md secao 10)
// ---------------------------------------------------------------------------

export const JOB_STATES = Object.freeze([
  'queued',
  'analyzing',
  'preparing',
  'downloading',
  'paused',
  'merging',
  'completed',
  'failed',
  'cancelled',
]);

export const TERMINAL_JOB_STATES = Object.freeze(['completed', 'failed', 'cancelled']);

/** Transicoes validas de cada estado (architect.md secoes 10 e 24). */
export const JOB_TRANSITIONS = Object.freeze({
  queued: Object.freeze(['analyzing', 'cancelled']),
  analyzing: Object.freeze(['preparing', 'failed', 'cancelled']),
  preparing: Object.freeze(['downloading', 'failed', 'cancelled']),
  downloading: Object.freeze(['paused', 'merging', 'completed', 'failed', 'cancelled']),
  paused: Object.freeze(['downloading', 'cancelled']),
  merging: Object.freeze(['completed', 'failed']),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

export function isValidJobState(state) {
  return typeof state === 'string' && JOB_STATES.includes(state);
}

export function isTerminalJobState(state) {
  return TERMINAL_JOB_STATES.includes(state);
}

export function canTransition(from, to) {
  return isValidJobState(from) && isValidJobState(to) && JOB_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * Cria um Format normalizado. Entrada aceita tanto o shape dos adapters
 * (formatId/url/container/codecs/qualityLabel/...) quanto um objeto parcial —
 * campos ausentes viram valores neutros, sem lancar.
 */
export function createFormat(input = {}) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('createFormat: entrada deve ser um objeto');
  }
  return {
    formatId: String(input.formatId || input.id || ''),
    url: String(input.url || ''),
    container: String(input.container || input.ext || ''),
    codecs: String(input.codecs || ''),
    qualityLabel: String(input.qualityLabel || input.resolution || ''),
    bitrate: Number(input.bitrate || input.bandwidth || 0) || 0,
    width: Number(input.width) || 0,
    height: Number(input.height) || 0,
    fps: Number(input.fps) || 0,
    hasVideo: Boolean(input.hasVideo ?? (input.vcodec && input.vcodec !== 'none')),
    hasAudio: Boolean(input.hasAudio ?? (input.acodec && input.acodec !== 'none')),
    contentLength: Number(input.contentLength || input.filesize || input.estimatedSize || 0) || 0,
  };
}

/** Valida o shape de um Format ja normalizado (ou parcial). */
export function isValidFormat(format) {
  return (
    format !== null &&
    typeof format === 'object' &&
    typeof format.formatId === 'string' &&
    typeof format.url === 'string' &&
    typeof format.bitrate === 'number' &&
    typeof format.hasVideo === 'boolean' &&
    typeof format.hasAudio === 'boolean'
  );
}

// ---------------------------------------------------------------------------
// MediaInfo
// ---------------------------------------------------------------------------

/**
 * Cria um MediaInfo normalizado a partir da analise de um adapter.
 * `formats` e opcional: quando ausente, e derivado de variants quando possivel.
 */
export function createMediaInfo(input = {}) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('createMediaInfo: entrada deve ser um objeto');
  }

  const rawFormats = Array.isArray(input.formats) ? input.formats : [];
  const progressiveFormats = Array.isArray(input.progressiveFormats)
    ? input.progressiveFormats.map((f) => createFormat(f))
    : [];
  const adaptiveVideoFormats = Array.isArray(input.adaptiveVideoFormats)
    ? input.adaptiveVideoFormats.map((f) => createFormat(f))
    : [];
  const adaptiveAudioFormats = Array.isArray(input.adaptiveAudioFormats)
    ? input.adaptiveAudioFormats.map((f) => createFormat(f))
    : [];
  const variants = Array.isArray(input.variants) ? input.variants : [];

  const formats = rawFormats.length
    ? rawFormats.map((f) => createFormat(f))
    : [...progressiveFormats, ...adaptiveVideoFormats, ...adaptiveAudioFormats];

  return {
    kind: String(input.kind || 'unknown'),
    sourceType: String(input.sourceType || input.kind || 'unknown'),
    provider: String(input.provider || ''),
    title: String(input.title || 'Video'),
    pageUrl: String(input.pageUrl || ''),
    videoId: String(input.videoId || ''),
    durationSeconds: Number(input.durationSeconds || input.duration || 0) || 0,
    formats,
    progressiveFormats,
    adaptiveVideoFormats,
    adaptiveAudioFormats,
    variants,
  };
}

/** Valida o shape de um MediaInfo. */
export function isValidMediaInfo(info) {
  return (
    info !== null &&
    typeof info === 'object' &&
    typeof info.title === 'string' &&
    typeof info.sourceType === 'string' &&
    Array.isArray(info.formats) &&
    Array.isArray(info.variants)
  );
}

// ---------------------------------------------------------------------------
// DownloadJob
// ---------------------------------------------------------------------------

let jobSequence = 0;

/**
 * Cria um DownloadJob com estado inicial `queued`.
 *
 * Opcoes:
 *  - id: identificador (default: "job-<n>" sequencial)
 *  - url: URL de origem (obrigatoria)
 *  - title: titulo opcional (preenchido na analise)
 *  - meta: mapa extra serializavel (opcional)
 */
export function createDownloadJob({ id, url, title = '', meta = {} } = {}) {
  if (!url || typeof url !== 'string') {
    throw new TypeError('createDownloadJob: url e obrigatoria');
  }
  if (meta === null || typeof meta !== 'object') {
    throw new TypeError('createDownloadJob: meta deve ser um objeto');
  }
  jobSequence += 1;
  const now = new Date().toISOString();
  return {
    id: String(id || `job-${jobSequence}`),
    url,
    title: String(title || ''),
    state: 'queued',
    error: null,
    meta: { ...meta },
    createdAt: now,
    updatedAt: now,
    history: [{ from: null, to: 'queued', at: now }],
  };
}

/**
 * Transiciona o job para `nextState`, validando contra JOB_TRANSITIONS.
 * Lanca Error com code 'INVALID_JOB_TRANSITION' se a transicao for invalida.
 * `error` (opcional) e gravado apenas em estados de falha/terminal.
 */
export function transitionJob(job, nextState, { error = null } = {}) {
  if (!isValidJobState(nextState)) {
    const err = new Error(`Estado invalido: "${nextState}"`);
    err.code = 'INVALID_JOB_STATE';
    throw err;
  }
  if (!canTransition(job.state, nextState)) {
    const err = new Error(`Transicao invalida: ${job.state} -> ${nextState}`);
    err.code = 'INVALID_JOB_TRANSITION';
    throw err;
  }
  const now = new Date().toISOString();
  job.state = nextState;
  job.updatedAt = now;
  job.error = error ? serializeError(error) : null;
  job.history.push({ from: job.history.at(-1).to, to: nextState, at: now });
  return job;
}

function serializeError(err) {
  if (err === null || typeof err !== 'object') return String(err);
  return {
    message: String(err.message || String(err)),
    code: err.code || '',
    needsAuth: Boolean(err.needsAuth),
    status: err.status || 0,
  };
}

/** Serializa o job sem campos circulares (metodos, referencias). */
export function serializeJob(job) {
  return {
    id: job.id,
    url: job.url,
    title: job.title,
    state: job.state,
    error: job.error,
    meta: { ...job.meta },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    history: job.history.map((entry) => ({ ...entry })),
  };
}

export function toJson(job) {
  return serializeJob(job);
}

// ---------------------------------------------------------------------------
// Helpers de conveniencia (shape "antigo" -> modelo)
// ---------------------------------------------------------------------------

/**
 * Converte uma variant HLS/master (shape: uri, resolution, width, height,
 * bandwidth, codecs) em um Format normalizado.
 */
export function formatFromVariant(variant = {}) {
  return createFormat({
    formatId: '',
    url: String(variant.uri || ''),
    container: '',
    codecs: String(variant.codecs || ''),
    qualityLabel: String(variant.resolution || ''),
    bitrate: Number(variant.bandwidth || 0) || 0,
    width: Number(variant.width) || 0,
    height: Number(variant.height) || 0,
    hasVideo: true,
    hasAudio: true,
  });
}
