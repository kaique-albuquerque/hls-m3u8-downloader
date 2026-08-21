import fs from 'node:fs';
import path from 'node:path';

import { CancelledError, ForbiddenError, NetworkError, RateLimitError, FastDownloaderError } from './errors.js';
import { computeRanges } from './planner.js';
import { createProgressReporter } from './progress.js';

const PART_FILE_SUFFIX = '.fdpart';
const PART_RETRY_LIMIT = 3;
const PART_RETRY_BASE_DELAY_MS = 750;

function createPartsDir(output) {
  return `${output}.parts`;
}

function createPartPath(partsDir, index) {
  return path.join(partsDir, `${String(index).padStart(4, '0')}${PART_FILE_SUFFIX}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryablePartError(err) {
  if (!err) return false;
  if (err instanceof CancelledError) return false;
  if (err instanceof RateLimitError || err instanceof NetworkError) return true;
  return err.retryable === true || /fetch failed|timeout|socket|network|reset|econn|terminated/i.test(err.message || '');
}

async function mergePartFiles(partsDir, ranges, output) {
  const out = await fs.promises.open(output, 'w');
  try {
    for (const range of ranges) {
      const input = await fs.promises.open(createPartPath(partsDir, range.index), 'r');
      try {
        const stat = await input.stat();
        const expected = range.end - range.start + 1;
        if (stat.size !== expected) throw new FastDownloaderError(`Parte ${range.index} incompleta no merge.`, { code: 'INCOMPLETE_RANGE' });
        let position = 0;
        while (position < stat.size) {
          const remaining = stat.size - position;
          const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, remaining));
          const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
          if (!bytesRead) break;
          await out.write(buffer.subarray(0, bytesRead), 0, bytesRead);
          position += bytesRead;
        }
      } finally {
        await input.close().catch(() => {});
      }
    }
  } finally {
    await out.close().catch(() => {});
  }
}

async function cleanupPartArtifacts(output) {
  await fs.promises.rm(createPartsDir(output), { recursive: true, force: true }).catch(() => {});
}

async function downloadToPartFile({ url, headers, range, partPath, onBytes }) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { ...headers, Range: `bytes=${range.start}-${range.end}` },
    redirect: 'follow',
  });
  if (res.status === 403) throw new ForbiddenError('HTTP 403 ao baixar parte.', { status: 403 });
  if (res.status === 429) throw new RateLimitError('HTTP 429 ao baixar parte.', { status: 429 });
  if (res.status >= 500) throw new NetworkError(`HTTP ${res.status} ao baixar parte.`, { status: res.status, retryable: true });
  if (res.status !== 206 || !res.body) throw new FastDownloaderError('Servidor nao respondeu 206 para a parte solicitada.', { code: 'RANGE_UNSUPPORTED' });

  const contentRange = res.headers.get('content-range') || '';
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(contentRange.trim());
  if (!match || Number(match[1]) !== range.start || Number(match[2]) !== range.end) {
    throw new FastDownloaderError(`Content-Range invalido para a parte (${contentRange || 'ausente'}).`, { code: 'INVALID_CONTENT_RANGE' });
  }

  const out = await fs.promises.open(partPath, 'w');
  try {
    const reader = res.body.getReader();
    let position = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        await out.write(value, 0, value.byteLength, position);
        position += value.byteLength;
        onBytes(value.byteLength);
      }
    }
    const expected = range.end - range.start + 1;
    if (position !== expected) {
      throw new FastDownloaderError(`Parte incompleta (esperado ${expected}, recebeu ${position}).`, { code: 'INCOMPLETE_RANGE' });
    }
  } finally {
    await out.close().catch(() => {});
  }
}

async function downloadPartWithRetry({ retryLimit = PART_RETRY_LIMIT, io, ...params }) {
  let lastError = null;
  for (let attempt = 1; attempt <= retryLimit; attempt++) {
    try {
      await fs.promises.unlink(params.partPath).catch(() => {});
      await downloadToPartFile(params);
      return;
    } catch (err) {
      lastError = err;
      if (!isRetryablePartError(err) || attempt >= retryLimit) throw err;
      const waitMs = PART_RETRY_BASE_DELAY_MS * attempt;
      io.log(`[turbo] Parte ${params.range.index + 1} falhou (${err.message}). Nova tentativa em ${waitMs}ms.`);
      await delay(waitMs);
    }
  }
  throw lastError;
}

export async function downloadSequential({ url, output, headers, totalBytes = 0, io = console }) {
  const progress = createProgressReporter(io, { totalBytes, label: 'Arquivo' });
  const res = await fetch(url, { method: 'GET', headers, redirect: 'follow' });
  if (!res.ok || !res.body) throw new FastDownloaderError(`HTTP ${res.status} ao baixar arquivo.`, { code: 'HTTP_ERROR', status: res.status });
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  const out = await fs.promises.open(output, 'w');
  let downloaded = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        await out.write(value, 0, value.byteLength, downloaded);
        downloaded += value.byteLength;
        progress.update(downloaded);
      }
    }
  } finally {
    await out.close().catch(() => {});
  }
  progress.finish(true);
  return { ok: true, output };
}

export async function downloadMultipart({
  url,
  output,
  headers,
  totalBytes,
  concurrency,
  blockCount,
  io = console,
}) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    throw new FastDownloaderError('Tamanho total desconhecido para download em partes.', { code: 'RANGE_SIZE_UNKNOWN' });
  }

  const partsDir = createPartsDir(output);
  const ranges = computeRanges(totalBytes, blockCount);
  await fs.promises.mkdir(partsDir, { recursive: true });

  const progress = createProgressReporter(io, { totalBytes, label: 'Arquivo' });
  let downloaded = 0;
  const pending = [...ranges];
  let failed = null;

  const workers = Array.from({ length: Math.min(concurrency, pending.length || 1) }, () =>
    (async () => {
      while (pending.length > 0 && !failed) {
        const current = pending.shift();
        if (!current) break;
        try {
          await downloadPartWithRetry({
            url,
            headers,
            range: current,
            partPath: createPartPath(partsDir, current.index),
            io,
            onBytes(bytes) {
              downloaded += bytes;
              progress.update(downloaded);
            },
          });
        } catch (err) {
          failed = err;
          break;
        }
      }
    })()
  );

  await Promise.all(workers);
  progress.finish(!failed);
  if (failed) {
    await cleanupPartArtifacts(output);
    throw failed;
  }

  await mergePartFiles(partsDir, ranges, output);
  await cleanupPartArtifacts(output);
  return { ok: true, output };
}
