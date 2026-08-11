/**
 * P2.3 — Event System (src/core/events.js)
 *
 * Secao 6/7 do architect.md: event bus tipado de progresso, sem dependencia
 * de UI. O engine (P2.5) emite eventos e a CLI/Electron consome — nunca
 * acoplando parsing de logs do FFmpeg diretamente a UI.
 *
 * Eventos (nomes usados pelo plano):
 *   start, progress, speed, eta, pause, resume, complete, error, cancel
 *
 * Payload padronizado de progresso:
 *   { bytesDownloaded, totalBytes, percent, speed, etaSeconds, stage,
 *     chunks, muxStatus, message }
 */

export const EVENT_NAMES = Object.freeze([
  'start',
  'progress',
  'speed',
  'eta',
  'pause',
  'resume',
  'complete',
  'error',
  'cancel',
]);

/** Alias conceituais do architect.md (secao 6): download:<nome>. */
export const DOWNLOAD_EVENT_NAMES = Object.freeze(EVENT_NAMES.map((name) => `download:${name}`));

/** Estados validos para a etapa atual (stage). */
export const JOB_STAGES = Object.freeze(['queued', 'analyzing', 'preparing', 'downloading', 'merging']);

export function isValidEventName(name) {
  return EVENT_NAMES.includes(name);
}

export function createProgressPayload(overrides = {}) {
  return {
    bytesDownloaded: 0,
    totalBytes: 0,
    percent: 0,
    speed: '',
    etaSeconds: null,
    stage: 'queued',
    chunks: 1,
    muxStatus: '',
    message: '',
    ...overrides,
  };
}

function normalizePayload(payload) {
  if (payload === null || typeof payload !== 'object') return {};
  return { ...payload };
}

/**
 * Cria um event bus.
 * - on/once/off: assina eventos (ex.: bus.on('progress', handler)).
 * - emit: dispara eventos; erros em handlers sao capturados (via onHandlerError,
 *   se fornecido) e nunca derrubam o emissor.
 * - subscribeDownload: assina por nome conceitual "download:<nome>".
 */
export function createEventBus({ onHandlerError } = {}) {
  const handlers = new Map();

  const normalizeName = (name) => {
    const s = String(name || '');
    return s.startsWith('download:') ? s.slice('download:'.length) : s;
  };

  const on = (name, handler) => {
    const key = normalizeName(name);
    if (!isValidEventName(key)) {
      throw new TypeError(`Evento invalido: "${name}"`);
    }
    if (typeof handler !== 'function') {
      throw new TypeError('handler deve ser uma funcao');
    }
    if (!handlers.has(key)) handlers.set(key, new Set());
    handlers.get(key).add(handler);
    return () => off(key, handler);
  };

  const once = (name, handler) => {
    const key = normalizeName(name);
    const wrapper = (...args) => {
      off(key, wrapper);
      handler(...args);
    };
    on(key, wrapper);
    return () => off(key, wrapper);
  };

  const off = (name, handler) => {
    const key = normalizeName(name);
    const set = handlers.get(key);
    if (set) set.delete(handler);
  };

  const emit = (name, payload) => {
    const key = normalizeName(name);
    if (!isValidEventName(key)) {
      throw new TypeError(`Evento invalido: "${name}"`);
    }
    const set = handlers.get(key);
    if (!set || set.size === 0) return;
    const normalized = normalizePayload(payload);
    for (const handler of [...set]) {
      try {
        handler(normalized, key);
      } catch (err) {
        if (typeof onHandlerError === 'function') onHandlerError(err, key, normalized);
        // senao: silencioso — handler com erro nunca derruba o emissor
      }
    }
  };

  return {
    on,
    once,
    off,
    emit,
    handlerCount: (name) => handlers.get(normalizeName(name))?.size || 0,
    names: EVENT_NAMES,
  };
}

export default createEventBus;
