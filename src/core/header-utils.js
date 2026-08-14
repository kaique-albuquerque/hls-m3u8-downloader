/**
 * Header-related utilities for StreamGrab.
 *
 * Extracted from src/utils.js (Sprint 2.3) for focused module responsibility.
 * All exports are re-exported from src/utils.js for backward compatibility.
 */

// Normaliza a grafia dos headers mais comuns.
const CANONICAL_HEADERS = {
  referer: 'Referer',
  origin: 'Origin',
  'user-agent': 'User-Agent',
};

/** Normaliza grafia de headers (ex.: "user-agent" → "User-Agent") e remove vazios. */
export function normalizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const value = String(v ?? '').trim();
    if (!value) continue;
    const lower = k.toLowerCase();
    out[CANONICAL_HEADERS[lower] || k] = value;
  }
  return out;
}
