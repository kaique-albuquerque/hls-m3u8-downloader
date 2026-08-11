/**
 * P4 — Transporte HTTP sequencial (plano §15/§16).
 *
 * Herda o papel do download direto que hoje vive em `cli/download.js`
 * (fluxo FFmpeg) e no `runStreamDownload` do engine: baixa uma URL direta
 * para arquivo via fetch nativo, com progresso, cancelamento e timeouts.
 *
 * Extras em relacao aos fluxos legados:
 *  - `detectAcceptRanges()`: sonda `Range: bytes=0-0` (206 -> suporta Range).
 *  - `downloadSequential({ validateMedia })`: detecta HTML/JSON no lugar de
 *    midia e lanca erro `NOT_MEDIA` (plano: "resposta HTML no lugar de midia").
 *  - Erros classificados na taxonomia (core/errors.js): 401/403/404/429/5xx,
 *    ENOSPC, EACCES etc. — permitindo strategy/retry por classe de erro.
 */

import fs from 'node:fs';
import { maskUrl } from '../utils.js';
import {
  StreamGrabError,
  NetworkError,
  AuthenticationError,
  ForbiddenError,
  MediaNotFoundError,
  RateLimitError,
  CancelledError,
  classifyError,
} from '../core/errors.js';

const DEFAULT_TIMEOUT_MS = 0; // 0 = sem timeout

/** Respostas que claramente nao sao midia. */
const NOT_MEDIA_CONTENT_TYPES = [/^text\/html\b/i, /^application\/json\b/i];

export function looksLikeHtml(text) {
  const t = String(text || '').trimStart();
  return /^<!doctype html/i.test(t) || /^<html[\s>/]/i.test(t);
}

export function looksLikeJson(text) {
  const t = String(text || '').trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

/**
 * Detecta se a resposta parece HTML/JSON em vez de midia binaria.
 * @param {string} contentType — header Content-Type (pode ser vazio).
 * @param {string} [bodySample] — primeiros bytes como texto (opcional).
 */
export function isNotMediaResponse(contentType, bodySample) {
  if (contentType) {
    for (const re of NOT_MEDIA_CONTENT_TYPES) {
      if (re.test(contentType)) return true;
    }
  }
  if (bodySample && (looksLikeHtml(bodySample) || looksLikeJson(bodySample))) return true;
  return false;
}

/** Monta o erro classificado para um status HTTP nao-ok. */
function httpErrorFor(res, url) {
  const status = res.status;
  const detail = `HTTP ${status} para ${maskUrl(url)}`;
  if (status === 401) return new AuthenticationError(detail, { status });
  if (status === 403) return new ForbiddenError(detail, { status });
  if (status === 404) return new MediaNotFoundError(detail, { status });
  if (status === 429) {
    const err = new RateLimitError(`HTTP 429 para ${maskUrl(url)}`, { status });
    err.retryAfter = res.headers.get('retry-after');
    return err;
  }
  if (status >= 500) return new NetworkError(detail, { status, retryable: true });
  return new StreamGrabError(detail, { code: 'HTTP_ERROR', status, retryable: false });
}

/** Cria um AbortController vinculado ao signal do caller + timeout. */
function makeController(signal, timeoutMs) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  return {
    controller,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/** Reclassifica AbortError: timeout do controller vs cancelamento do caller. */
function rethrowAbort(err, signal) {
  if (signal?.aborted) return new CancelledError('Operacao cancelada.');
  if (err?.name === 'AbortError') return new NetworkError('Timeout ao conectar.', { retryable: true });
  return classifyError(err);
}

/**
 * Sonda o suporte a Range do servidor (`Range: bytes=0-0`).
 * @returns {Promise<{ok: true, acceptRanges: boolean, total: number, status: number}>}
 * @throws erro classificado (403/429/5xx viram Forbidden/RateLimit/Network).
 */
export async function detectAcceptRanges(url, { headers = {}, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { controller, cleanup } = makeController(signal, timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...headers, Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    try {
      if (res.status === 206) {
        const contentRange = res.headers.get('content-range') || '';
        const m = /^bytes\s+\d+-\d+\/(\d+|\*)$/.exec(contentRange.trim());
        const total = m && m[1] !== '*' ? Number(m[1]) : 0;
        return { ok: true, acceptRanges: true, total, status: 206 };
      }
      if (!res.ok) throw httpErrorFor(res, url);
      return { ok: true, acceptRanges: false, total: 0, status: res.status };
    } finally {
      await res.body?.cancel?.().catch(() => {});
    }
  } catch (err) {
    throw rethrowAbort(err, signal);
  } finally {
    cleanup();
  }
}

/**
 * Baixa `url` sequencialmente para `output` via fetch nativo.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {string} params.output — caminho do arquivo de saida.
 * @param {object} [params.headers]
 * @param {AbortSignal} [params.signal]
 * @param {Function} [params.onProgress] — `({bytesDownloaded, totalBytes, percent, speed, etaSeconds})`.
 * @param {number} [params.timeoutMs] — 0 = sem timeout.
 * @param {boolean} [params.validateMedia] — detecta HTML/JSON no lugar de midia.
 * @returns {Promise<{ok: true, bytesDownloaded: number, totalBytes: number}>}
 * @throws erro classificado da taxonomia (Network/Forbidden/RateLimit/NOT_MEDIA...).
 */
export async function downloadSequential({
  url,
  output,
  headers = {},
  signal,
  onProgress,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  validateMedia = true,
} = {}) {
  const { controller, cleanup } = makeController(signal, timeoutMs);
  const started = Date.now();
  let downloaded = 0;

  const fh = await fs.promises.open(output, 'w');
  try {
    const res = await fetch(url, { method: 'GET', headers, redirect: 'follow', signal: controller.signal });
    if (!res.ok) throw httpErrorFor(res, url);

    const contentType = res.headers.get('content-type') || '';
    if (validateMedia && isNotMediaResponse(contentType)) {
      const err = new StreamGrabError(`Resposta nao e midia (${contentType || 'desconhecido'}).`, {
        code: 'NOT_MEDIA',
        status: res.status,
      });
      throw err;
    }

    const declaredTotal = Number(res.headers.get('content-length') || 0);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        await fh.write(value, 0, value.byteLength);
        downloaded += value.byteLength;
        const elapsed = Date.now() - started;
        const speed = elapsed > 0 ? Math.round((downloaded / elapsed) * 1000) : 0;
        const etaSeconds = speed > 0 && declaredTotal > downloaded ? Math.round((declaredTotal - downloaded) / speed) : null;
        onProgress?.({
          bytesDownloaded: downloaded,
          totalBytes: declaredTotal || 0,
          percent: declaredTotal ? Math.min(100, Math.round((downloaded / declaredTotal) * 100)) : 0,
          speed,
          etaSeconds,
        });
      }
    }
    onProgress?.({ bytesDownloaded: downloaded, totalBytes: declaredTotal || downloaded, percent: 100, speed: 0, etaSeconds: 0 });
    return { ok: true, bytesDownloaded: downloaded, totalBytes: declaredTotal || downloaded };
  } catch (err) {
    throw rethrowAbort(err, signal);
  } finally {
    await fh.close().catch(() => {});
    cleanup();
  }
}

export default { downloadSequential, detectAcceptRanges, isNotMediaResponse, looksLikeHtml, looksLikeJson };
