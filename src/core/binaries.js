import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const RESOURCES_PATH_ENV = 'STREAMGRAB_RESOURCES_PATH';

export function binName(base) {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

export function getPackagedResourcesPath() {
  const raw = process.env[RESOURCES_PATH_ENV];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

export function packagedBinaryPath(name) {
  const root = getPackagedResourcesPath();
  return root ? path.join(root, 'bin', name) : '';
}

export function hasPackagedBinary(name, { fsImpl = fs } = {}) {
  const p = packagedBinaryPath(name);
  return Boolean(p) && fsImpl.existsSync(p);
}

let cachedYtDlp = null;

export async function getYtDlpExec({ fsImpl = fs } = {}) {
  if (cachedYtDlp) return cachedYtDlp;
  const packaged = packagedBinaryPath(binName('yt-dlp'));
  if (packaged && fsImpl.existsSync(packaged)) {
    const mod = await import('youtube-dl-exec');
    if (typeof mod.create === 'function') {
      cachedYtDlp = mod.create(packaged);
      return cachedYtDlp;
    }
  }
  const mod = await import('youtube-dl-exec');
  cachedYtDlp = mod.youtubeDl;
  return cachedYtDlp;
}

export function resetYtDlpCache() {
  cachedYtDlp = null;
}
