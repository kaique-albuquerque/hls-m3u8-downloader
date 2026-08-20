import path from 'node:path';

import { sanitizeFilename } from '../utils.js';

export const DEFAULT_TURBO_CHUNKS = 8;
export const MAX_FILE_TURBO_CHUNKS = 1024;
export const PART_FILE_SUFFIX = '.sgpart';
export const PART_MANIFEST_VERSION = 1;
export const PART_RETRY_LIMIT = 3;
export const PART_RETRY_BASE_DELAY_MS = 750;
export const PART_IDLE_WAIT_MS = 250;
export const MAX_CONCURRENCY_DOWNGRADES = 6;
export const FILE_DOWNLOAD_PRESETS = {
  auto: { label: 'Auto', concurrency: 8, blockCount: 0 },
  conservative: { label: 'Conservador', concurrency: 4, blockCount: 0 },
  aggressive: { label: 'Agressivo', concurrency: 16, blockCount: 0 },
  custom: { label: 'Personalizado', concurrency: 8, blockCount: 0 },
};

export function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || '';
  } catch {
    return '';
  }
}

export function sanitizePreservingExtension(name) {
  const ext = path.extname(name || '');
  const base = ext ? name.slice(0, -ext.length) : name;
  const safeBase = sanitizeFilename(base || 'arquivo');
  const safeExt = ext.replace(/[<>:"/\\|?*]/g, '').trim();
  return `${safeBase}${safeExt}`;
}

export function normalizeChunkCount(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_TURBO_CHUNKS;
  return Math.min(parsed, MAX_FILE_TURBO_CHUNKS);
}

export function computeRanges(total, count) {
  const ranges = [];
  const chunkSize = Math.ceil(total / count);
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    if (start >= total) break;
    ranges.push({ index: i, start, end: Math.min(total - 1, start + chunkSize - 1) });
  }
  return ranges;
}

export function buildFallbackRemote(target, requestedName = '') {
  const fallbackName = sanitizePreservingExtension(requestedName || filenameFromUrl(target) || 'arquivo.bin');
  return {
    url: target,
    totalBytes: 0,
    contentType: '',
    filename: fallbackName,
    capability: 'NO_RANGE',
    probeMethod: 'fallback',
    metadataConfidence: 'low',
    etag: '',
    lastModified: '',
  };
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
