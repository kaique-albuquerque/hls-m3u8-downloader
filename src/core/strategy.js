/**
 * P4 — Seletor de estrategia de transporte + fallback por classe de erro.
 *
 * Regras do plano (§16 / §41):
 *  - Escolhe o transporte inicial a partir da fonte/prepared (mux, ffmpeg,
 *    http sequencial, range paralelo, curl-impersonate, yt-dlp runner).
 *  - Fallback POR CLASSE DE ERRO:
 *      * Erros retryable (Network/429/5xx)  -> `retry` (mesma estrategia).
 *      * RANGE_UNSUPPORTED no range         -> `fallback` para http sequencial.
 *      * 403/401/DRM/URL expirada/nao-midia -> `stop` — NUNCA loop de transports.
 *  - 403 nunca dispara loop de transports (plano §6).
 */

import { isRetryable } from './errors.js';

export const STRATEGIES = Object.freeze({
  MUX: 'mux',
  FFMPEG: 'ffmpeg',
  HTTP: 'http',
  RANGE: 'range',
  CURL: 'curl',
  YTDLP: 'ytdlp',
});

/**
 * Erros terminais: sem fallback para outro transporte, sem retry.
 * (401/403/DRM/URL expirada/midia ausente/suporte ausente/cancelamento/disco/permissao)
 */
export const TERMINAL_CODES = new Set([
  'UNSUPPORTED_SOURCE',
  'AUTHENTICATION_ERROR',
  'FORBIDDEN_ERROR',
  'UNSUPPORTED_DRM_ERROR',
  'EXPIRED_URL',
  'EXPIRED_URL_ERROR',
  'MEDIA_NOT_FOUND',
  'MEDIA_NOT_FOUND_ERROR',
  'NOT_MEDIA',
  'CANCELLED',
  'ENOSPC',
  'DISK_SPACE_ERROR',
  'EACCES',
  'EPERM',
  'PERMISSION_ERROR',
  'UNSUPPORTED_FORMAT',
]);

/**
 * Escolhe a estrategia inicial de transporte.
 *
 * @param {object} params
 * @param {string} [params.sourceType] — id do adapter/provider (direct, hls, dash, youtube, social, ytdlp).
 * @param {object} [params.prepared] — resultado do prepareDownload ({ strategy, downloadUrl, ... }).
 * @param {object} [params.options]
 * @param {boolean} [params.options.turbo] — prefere download paralelo por Range.
 * @param {boolean} [params.options.useYtDlpDownload] — usa o runner yt-dlp para download.
 * @returns {string} uma das STRATEGIES.
 */
export function selectStrategy({ sourceType, prepared = {}, options = {} } = {}) {
  if (prepared.strategy === 'mux') return STRATEGIES.MUX;
  if (sourceType === 'hls' || sourceType === 'dash') return STRATEGIES.FFMPEG;
  if (sourceType === 'ytdlp' || sourceType === 'youtube' || sourceType === 'social') {
    if (options.useYtDlpDownload && options.formatId) return STRATEGIES.YTDLP;
    return STRATEGIES.HTTP;
  }
  if (sourceType === 'direct') {
    return options.turbo ? STRATEGIES.RANGE : STRATEGIES.HTTP;
  }
  return STRATEGIES.HTTP;
}

/**
 * Decide a proxima acao apos um erro da estrategia atual.
 *
 * @param {object} params
 * @param {string} params.strategy — estrategia que falhou.
 * @param {Error} params.error — erro classificado.
 * @returns {{ action: 'retry'|'fallback'|'stop', strategy?: string, reason?: string }}
 */
export function resolveFallback({ strategy, error } = {}) {
  const code = error?.code || '';
  if (isRetryable(error)) {
    return { action: 'retry', strategy, reason: 'erro retryable — nova tentativa com backoff' };
  }
  if (TERMINAL_CODES.has(code)) {
    return { action: 'stop', reason: `erro terminal (${code}) — sem loop de transports` };
  }
  if (code === 'RANGE_UNSUPPORTED' && strategy === STRATEGIES.RANGE) {
    return { action: 'fallback', strategy: STRATEGIES.HTTP, reason: 'servidor sem Range — fallback para http sequencial' };
  }
  if (code === 'INVALID_CONTENT_RANGE' && strategy === STRATEGIES.RANGE) {
    return { action: 'fallback', strategy: STRATEGIES.HTTP, reason: 'Content-Range invalido — fallback para http sequencial' };
  }
  return { action: 'stop', reason: 'erro nao-retryable sem fallback definido' };
}

/** Se o erro permite tentar outra estrategia. */
export function canFallback({ strategy, error } = {}) {
  return resolveFallback({ strategy, error }).action !== 'stop';
}

/** Se o erro e terminal (nunca re-tenta, nunca troca de transporte). */
export function isTerminalError(error) {
  const code = error?.code || '';
  return TERMINAL_CODES.has(code) || !isRetryable(error);
}

export default { STRATEGIES, TERMINAL_CODES, selectStrategy, resolveFallback, canFallback, isTerminalError };
