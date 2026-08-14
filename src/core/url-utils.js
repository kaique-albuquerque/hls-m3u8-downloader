/**
 * URL-related utilities for StreamGrab.
 *
 * Extracted from src/utils.js (Sprint 2.3) for focused module responsibility.
 * All exports are re-exported from src/utils.js for backward compatibility.
 */

// Query parameters considered sensitive — values are masked
// in any display or log (we never record the full URL).
const SENSITIVE_PARAMS =
  /^(token|access_token|authorization|auth|sid|uid|signature|sig|key|api[_-]?key|secret|password|pass|pwd|session|session_id|jwt)$/i;

// Accidental Markdown formatting escapes (\&, \_, \?, \= etc.).
const MARKDOWN_ESCAPES = /\\([&_?=%*#!.\-()\[\]{}~])/g;

/**
 * User-Agent padrao para requisicoes fetch.
 * O fetch do Node (undici) nao envia User-Agent por padrao e varios CDNs/WAFs
 * rejeitam com 403 requisicoes sem UA — mesmo comportamento do FFmpeg (que
 * sempre envia um) e do probe de content-type.
 */
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

/**
 * Limpa a entrada colada pelo usuário:
 * - extrai a URL real de um link Markdown `[texto](url)`;
 * - remove aspas, colchetes e escapes acidentais de Markdown.
 */
export function normalizeUrl(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';

  // Markdown link: [text](url) → extract URL from parentheses.
  const md = s.match(/\[([^\]]*)\]\(([^)]*)\)/);
  if (md) {
    const inside = (md[2] || '').trim() || (md[1] || '').trim();
    if (inside) s = inside;
  }

  // Remove leftover quotes, `< >`, `( )` etc. from copy-paste.
  s = s.replace(/^[<("'`]+|[>)"'`]+$/g, '');
  s = s.replace(/^\[/, '').replace(/\]$/, '');

  // Remove accidental Markdown escapes: \&, \_, \?, \=, \%, etc.
  s = s.replace(MARKDOWN_ESCAPES, '$1');

  return s.trim();
}

/**
 * Valida se o valor parece uma URL HTTP/HTTPS de playlist HLS (.m3u8).
 */
export function isValidM3u8Url(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.pathname.includes('.m3u8');
  } catch {
    return false;
  }
}

/**
 * Mascara valores de parâmetros sensíveis na query string,
 * mantendo o restante visível. Ex.:
 *   https://.../index.m3u8?cP=1997000&access_token=***&sid=***
 */
export function maskUrl(value) {
  try {
    const u = new URL(value);
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_PARAMS.test(key)) u.searchParams.set(key, '***');
    }
    return u.toString();
  } catch {
    return String(value);
  }
}
