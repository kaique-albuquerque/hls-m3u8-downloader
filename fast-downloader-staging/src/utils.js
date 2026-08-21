import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

export function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const markdown = raw.match(/\((https?:\/\/[^)\s]+)\)/i);
  const cleaned = markdown ? markdown[1] : raw.replace(/^["'(<]+|[>"')]+$/g, '');
  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeHeaders(entries = []) {
  const normalized = {};
  for (const [key, value] of entries) {
    if (!key || value == null || value === '') continue;
    normalized[String(key)] = String(value);
  }
  if (!normalized['User-Agent'] && !normalized['user-agent']) {
    normalized['User-Agent'] = DEFAULT_USER_AGENT;
  }
  return normalized;
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function getDefaultDownloadsDir() {
  const home = os.homedir();
  const candidates = [path.join(home, 'Downloads'), home, process.cwd()];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      // ignore
    }
  }
  return process.cwd();
}

export function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[.\s]+$/g, '')
    .replace(/^[.\s]+/g, '');
  return cleaned || 'arquivo';
}

export function sanitizePreservingExtension(name) {
  const ext = path.extname(name || '');
  const base = ext ? name.slice(0, -ext.length) : name;
  return `${sanitizeFilename(base || 'arquivo')}${ext.replace(/[<>:"/\\|?*]/g, '')}`;
}

export function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    return '';
  }
}

export function parseHeaderArgs(argv = []) {
  const headers = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--header') continue;
    const raw = String(argv[i + 1] || '');
    i += 1;
    const idx = raw.indexOf(':');
    if (idx <= 0) continue;
    headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
  }
  return headers;
}
