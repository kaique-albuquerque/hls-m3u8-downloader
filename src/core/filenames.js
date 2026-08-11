/**
 * P2.2 — Politica central de filenames (src/core/filenames.js)
 *
 * Secao 23 do architect.md: caracteres invalidos Windows, Unicode, nomes
 * reservados, comprimento (bytes), colisoes "Video (1).mp4", extensao correta
 * e bloqueio de path traversal vindo de metadata externa.
 */

import path from 'node:path';
import fs from 'node:fs';

const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*]/g;

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Limite do NTFS para o nome do arquivo (sem o caminho). */
export const MAX_FILENAME_BYTES = 255;

/** Sanitiza um nome para ser seguro no Windows (sem extensao obrigatoria). */
export function sanitizeFilename(name) {
  let n = String(name ?? '').trim();
  n = n.replace(WINDOWS_INVALID_CHARS, '_');
  n = n.replace(/[.\s]+$/g, '');
  n = n.replace(/^[.\s]+/g, '');
  if (!n) n = 'video';
  const base = n.replace(/\.mp4$/i, '');
  if (RESERVED_NAMES.test(base)) n = `_${base}`;
  return n;
}

/**
 * Trunca um nome para caber em maxBytes (UTF-8), sem cortar no meio
 * de um caractere multibyte. O limite padrao e o do NTFS (255 bytes).
 */
export function truncateToBytes(name, maxBytes = MAX_FILENAME_BYTES) {
  const s = String(name ?? '');
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  let out = '';
  let size = 0;
  for (const ch of s) {
    const chLen = Buffer.byteLength(ch, 'utf8');
    if (size + chLen > maxBytes) break;
    out += ch;
    size += chLen;
  }
  return out;
}

/** Garante a extensao (default .mp4), sem duplicar. */
export function ensureExtension(name, ext = '.mp4') {
  const s = String(name ?? '');
  const e = String(ext || '').toLowerCase();
  return e && s.toLowerCase().endsWith(e) ? s : `${s}${ext}`;
}

/**
 * true se o valor nao contem segmentos ".." nem NUL — ou seja, nao pode
 * escapar do diretorio de saida. Nota: "a..b" e seguro; "../x" nao.
 */
export function isPathTraversalSafe(value) {
  const s = String(value ?? '');
  if (s.includes('\0')) return false;
  return !s.split(/[/\\]/).some((seg) => seg === '..');
}

/** Mantem apenas o basename (bloqueia traversal por diretorio). */
export function baseNameOnly(value) {
  const s = String(value ?? '').replace(/\0/g, '');
  return path.basename(s).trim();
}

/**
 * Monta um caminho de saida seguro a partir de qualquer metadata externa:
 * extrai o basename (bloqueia traversal), sanitiza, trunca para o limite de
 * bytes (descontando a extensao) e garante a extensao.
 */
export function resolveSafeFilename(input, { dir = '', ext = '.mp4' } = {}) {
  const base = baseNameOnly(input);
  let name = sanitizeFilename(base);
  name = truncateToBytes(name, MAX_FILENAME_BYTES - Buffer.byteLength(ext, 'utf8'));
  name = ensureExtension(name, ext);
  return dir ? path.join(dir, name) : name;
}

/**
 * Retorna o proximo nome disponivel quando ja existe: "Video.mp4" ->
 * "Video (1).mp4" -> "Video (2).mp4" ...
 * `exists` e injetavel para testes (default: fs.existsSync).
 */
export function nextAvailableName(outputPath, exists = (p) => fs.existsSync(p)) {
  const dir = path.dirname(outputPath);
  const ext = path.extname(outputPath);
  const base = path.basename(outputPath, ext);
  if (!exists(outputPath)) return outputPath;
  let i = 1;
  let candidate = path.join(dir, `${base} (${i})${ext}`);
  while (exists(candidate)) {
    i += 1;
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  return candidate;
}
