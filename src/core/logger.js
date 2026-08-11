/**
 * P2.2 — Logger com redacao (src/core/logger.js)
 *
 * Secao 27 do architect.md: niveis debug/info/warn/error e sanitizacao.
 * Regras de redacao:
 *  - URLs assinadas (query com token/access_token/sid/uid/...) -> maskUrl()
 *  - headers Authorization/Cookie inline no texto -> ***
 *  - objetos (ex.: headers) com chaves sensiveis -> ***
 *  - stderr de processos externos (string) -> mesma redacao de texto
 */

import { maskUrl } from '../utils.js';

export const LOG_LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

const SENSITIVE_HEADER_NAMES = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i;

// Mesma lista do maskUrl (utils.js) adaptada para chaves de objeto.
const SENSITIVE_OBJECT_KEYS = /(token|secret|password|passwd|pwd|pass|credential|api[_-]?key|authorization|auth|cookie|signature|sig|sid|uid|session|session_id|jwt)$/i;

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

// Redige o valor inteiro apos o header (ate fim de linha/virgula/ponto-e-virgula),
// cobrindo "Bearer <token>", "Cookie: a=b; Path=/", etc.
const INLINE_HEADER_RE = /\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n,;]+/gi;

/** Redige segredos em texto livre (mensagens, stderr, logs). */
export function redactText(value) {
  let out = String(value ?? '');
  out = out.replace(URL_RE, (m) => maskUrl(m));
  out = out.replace(INLINE_HEADER_RE, (_m, header) => `${header}:***`);
  return out;
}

/** Redige valores de headers conhecidos por conter segredo. */
export function redactHeaders(headers = {}) {
  const out = {};
  for (const [key, val] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADER_NAMES.test(key) ? '***' : val;
  }
  return out;
}

/** Redige qualquer valor recursivamente (strings, objetos, arrays). */
export function redact(value) {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_OBJECT_KEYS.test(key) && typeof val === 'string' ? '***' : redact(val);
    }
    return out;
  }
  return String(value);
}

/**
 * Cria um logger com redacao automatica.
 * - level: debug|info|warn|error (filtro por nivel).
 * - sink: objeto { debug, info, warn, error } (default: console).
 *   Injete um sink nos testes para capturar as mensagens ja redigidas.
 */
export function createLogger({ level = 'info', sink } = {}) {
  const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  const write = sink || {
    debug: (...args) => console.debug(...args),
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
  };

  const log = (lvl, args) => {
    if ((LOG_LEVELS[lvl] ?? 0) < threshold) return;
    const fn = write[lvl] || write.info;
    fn(...args.map((a) => (typeof a === 'string' ? redactText(a) : redact(a))));
  };

  return {
    level,
    debug: (...args) => log('debug', args),
    info: (...args) => log('info', args),
    warn: (...args) => log('warn', args),
    error: (...args) => log('error', args),
    redact,
    redactText,
    redactHeaders,
  };
}

export default createLogger;
