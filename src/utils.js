import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Parâmetros de query considerados sensíveis — os valores serão mascarados
// em qualquer exibição ou log (nunca registramos a URL completa).
const SENSITIVE_PARAMS =
  /^(token|access_token|authorization|auth|sid|uid|signature|sig|key|api[_-]?key|secret|password|pass|pwd|session|session_id|jwt)$/i;

// Caracteres inválidos em nomes de arquivo no Windows.
const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*]/g;

// Nomes reservados pelo Windows (CON, PRN, AUX, NUL, COM1..9, LPT1..9).
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Escapes acidentais típicos de formatação Markdown (\&, \_, \?, \= etc.).
const MARKDOWN_ESCAPES = /\\([&_?=%*#!.\-()\[\]{}~])/g;

// Normaliza a grafia dos headers mais comuns.
const CANONICAL_HEADERS = {
  referer: 'Referer',
  origin: 'Origin',
  'user-agent': 'User-Agent',
};

/**
 * Limpa a entrada colada pelo usuário:
 * - extrai a URL real de um link Markdown `[texto](url)`;
 * - remove aspas, colchetes e escapes acidentais de Markdown.
 */
export function normalizeUrl(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';

  // Link Markdown: [texto](url) → extrai a URL de dentro dos parênteses.
  const md = s.match(/\[([^\]]*)\]\(([^)]*)\)/);
  if (md) {
    const inside = (md[2] || '').trim() || (md[1] || '').trim();
    if (inside) s = inside;
  }

  // Remove sobras de aspas, `< >`, `( )` etc. vindas da cópia.
  s = s.replace(/^[<("'`]+|[>)"'`]+$/g, '');
  s = s.replace(/^\[/, '').replace(/\]$/, '');

  // Remove escapes acidentais de Markdown: \&, \_, \?, \=, \%, etc.
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

/**
 * Sanitiza um nome de arquivo para ser seguro no Windows:
 * remove < > : " / \ | ? * e espaços/pontos finais.
 */
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
 * Adiciona .mp4 automaticamente se o usuário não informou extensão.
 */
export function ensureMp4(name) {
  return /\.mp4$/i.test(name) ? name : `${name}.mp4`;
}

/**
 * Pasta padrão de saída no Windows: Downloads do usuário atual,
 * obtida programaticamente (sem nome de usuário hardcoded).
 */
export function getDefaultDownloadsDir() {
  const home = os.homedir();
  const candidates = [path.join(home, 'Downloads'), home, process.cwd()];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* tenta a próxima */
    }
  }
  return home;
}

/** Formata bytes para B/KB/MB/GB/TB. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Formata bandwidth (bps) do HLS para Kbps/Mbps. */
export function formatKbps(bandwidth) {
  const n = Number(bandwidth) || 0;
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(n / 1000)} Kbps`;
}

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

/**
 * Lê o conteúdo da área de transferência do Windows via PowerShell.
 * (spawn, sem exec — sem risco de injeção de comando)
 */
export function getClipboardText() {
  try {
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    if (res.status === 0 && res.stdout) {
      return String(res.stdout).trim();
    }
  } catch {
    /* clipboard indisponível (sem Windows/PowerShell) */
  }
  return '';
}
