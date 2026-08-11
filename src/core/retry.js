/**
 * P4 — Retry com backoff exponencial + jitter.
 *
 * Regras (plano §16 / §41):
 *  - Atraso exponencial com fator 2, limitado por maxDelayMs.
 *  - Jitter aleatorio de 50-100% do atraso calculado (evita thundering herd).
 *  - Respeita o header/atributo `Retry-After` (segundos ou data HTTP).
 *  - Erros permanentes (nao-retryable, ex.: 401/403/DRM) NUNCA sao retentados:
 *    `shouldRetry` padrao = `isRetryable` da taxonomia (core/errors.js).
 */

import { isRetryable } from './errors.js';

/**
 * Calcula o atraso para a tentativa `attempt` (0-based).
 * @returns {number} milissegundos.
 */
export function computeBackoffDelay(attempt, { baseDelayMs = 500, maxDelayMs = 30000, jitter = true } = {}) {
  const exp = Math.min(Math.max(0, Math.floor(attempt)), 10);
  const base = baseDelayMs * 2 ** exp;
  const capped = Math.min(base, maxDelayMs);
  if (!jitter) return Math.round(capped);
  // Jitter: 50%..100% do atraso — nunca reduz abaixo do backoff nominal.
  return Math.round(capped / 2 + Math.random() * (capped / 2));
}

/**
 * Converte um valor `Retry-After` em milissegundos.
 * Aceita segundos inteiros ou uma data HTTP (Date.parse).
 * @param {string|number|null|undefined} value
 * @returns {number|null} ms, ou null quando invalido/ausente.
 */
export function parseRetryAfter(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const date = Date.parse(v);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

/**
 * Extrai `Retry-After` de um erro classificado (propriedade `retryAfter`)
 * ou de `err.headers` (Headers do fetch ou objeto simples).
 * @param {Error} err
 * @returns {number|null} ms.
 */
export function retryAfterFromError(err) {
  if (!err) return null;
  const direct = parseRetryAfter(err.retryAfter);
  if (direct != null) return direct;
  const headers = err.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return parseRetryAfter(headers.get('retry-after'));
  if (typeof headers === 'object') {
    return parseRetryAfter(headers['retry-after'] ?? headers.retryAfter ?? headers['Retry-After']);
  }
  return null;
}

/** Dorme `ms` milissegundos; aborta com erro code CANCELLED quando `signal` dispara. */
export function sleep(ms, signal) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Operacao cancelada durante o backoff.');
      err.code = 'CANCELLED';
      reject(err);
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      const err = new Error('Operacao cancelada durante o backoff.');
      err.code = 'CANCELLED';
      reject(err);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Executa `fn` com retry exponencial.
 *
 * @param {object} opts
 * @param {Function} opts.fn — chamada como `fn(attempt)` (0-based).
 * @param {Function} [opts.shouldRetry] — `(err) => boolean`; padrao `isRetryable`.
 * @param {number} [opts.maxAttempts=4] — total de tentativas (1 = sem retry).
 * @param {number} [opts.baseDelayMs=500] — atraso da primeira retentativa.
 * @param {number} [opts.maxDelayMs=30000] — teto do backoff.
 * @param {boolean} [opts.jitter=true]
 * @param {AbortSignal} [opts.signal]
 * @param {Function} [opts.onRetry] — `({attempt, delay, error})` antes de dormir.
 * @returns {Promise<*>} retorno da ultima tentativa.
 * @throws o ultimo erro quando `maxAttempts` se esgota ou o erro nao e retryable.
 */
export async function retryWithBackoff({
  fn,
  shouldRetry = isRetryable,
  maxAttempts = 4,
  baseDelayMs = 500,
  maxDelayMs = 30000,
  jitter = true,
  signal,
  onRetry,
} = {}) {
  if (typeof fn !== 'function') throw new TypeError('retryWithBackoff: fn e obrigatorio');
  const attempts = Math.max(1, Math.floor(maxAttempts));
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (signal?.aborted) throw err;
      const retryable = shouldRetry(err) === true;
      const hasAttemptsLeft = attempt < attempts - 1;
      if (!retryable || !hasAttemptsLeft) throw err;

      const retryAfter = retryAfterFromError(err);
      const delay =
        retryAfter != null
          ? Math.max(0, retryAfter)
          : computeBackoffDelay(attempt, { baseDelayMs, maxDelayMs, jitter });
      onRetry?.({ attempt, delay, error: err });
      await sleep(delay, signal);
    }
  }
  throw new Error('retryWithBackoff: inalcancavel'); // eslint-disable-line no-unreachable
}

export default { retryWithBackoff, computeBackoffDelay, parseRetryAfter, retryAfterFromError, sleep };
