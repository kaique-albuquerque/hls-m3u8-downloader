import fs from 'node:fs';
import path from 'node:path';

import {
  CancelledError,
  ForbiddenError,
  NetworkError,
  RateLimitError,
  StreamGrabError,
} from '../core/errors.js';
import { createProgressReporter } from './progress.js';
import {
  computeRanges,
  delay,
  MAX_CONCURRENCY_DOWNGRADES,
  PART_FILE_SUFFIX,
  PART_IDLE_WAIT_MS,
  PART_MANIFEST_VERSION,
  PART_RETRY_BASE_DELAY_MS,
  PART_RETRY_LIMIT,
} from './file-download-shared.js';

function createPartsDir(output) {
  return `${output}.parts`;
}

function createPartPath(partsDir, index) {
  return path.join(partsDir, `${String(index).padStart(4, '0')}${PART_FILE_SUFFIX}`);
}

function createPartManifestPath(output) {
  return `${output}.parts.json`;
}

async function mergePartFiles(partsDir, ranges, output) {
  const out = await fs.promises.open(output, 'w');
  try {
    for (const range of ranges) {
      const partPath = createPartPath(partsDir, range.index);
      const input = await fs.promises.open(partPath, 'r');
      try {
        const stat = await input.stat();
        const expected = range.end - range.start + 1;
        if (stat.size !== expected) {
          throw new StreamGrabError(`Parte ${range.index} incompleta no merge.`, { code: 'INCOMPLETE_RANGE' });
        }
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

async function cleanupPartsDir(partsDir) {
  await fs.promises.rm(partsDir, { recursive: true, force: true }).catch(() => {});
}

async function cleanupPartArtifacts(output) {
  await cleanupPartsDir(createPartsDir(output));
  await fs.promises.unlink(createPartManifestPath(output)).catch(() => {});
  await fs.promises.unlink(`${createPartManifestPath(output)}.tmp`).catch(() => {});
}

function createPartManifest({ url, output, totalBytes, etag = '', lastModified = '', ranges = [] }) {
  const now = new Date().toISOString();
  return {
    version: PART_MANIFEST_VERSION,
    url,
    output,
    totalBytes,
    etag: etag || '',
    lastModified: lastModified || '',
    createdAt: now,
    updatedAt: now,
    parts: ranges.map((range) => ({
      index: range.index,
      start: range.start,
      end: range.end,
      completed: false,
      size: 0,
    })),
  };
}

function loadPartManifest(manifestPath) {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== PART_MANIFEST_VERSION || !Array.isArray(parsed.parts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function savePartManifest(manifestPath, manifest) {
  if (!manifestPath || !manifest) return false;
  manifest.updatedAt = new Date().toISOString();
  const tmpPath = `${manifestPath}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
    await fs.promises.rename(tmpPath, manifestPath);
    return true;
  } catch {
    return false;
  }
}

function validatePartManifest(manifest, { url, totalBytes, etag = '', lastModified = '', blockCount }) {
  if (!manifest) return { ok: false, reason: 'manifest ausente' };
  if (manifest.url !== url) return { ok: false, reason: 'URL final mudou' };
  if (Number(manifest.totalBytes || 0) !== Number(totalBytes || 0)) return { ok: false, reason: 'tamanho total mudou' };
  if (Number(manifest.parts?.length || 0) !== Number(blockCount || 0)) return { ok: false, reason: 'quantidade de partes mudou' };
  if (manifest.etag && etag && manifest.etag !== etag) return { ok: false, reason: 'ETag mudou' };
  if (manifest.etag && !etag) return { ok: false, reason: 'ETag antigo existe mas o servidor nao enviou validator agora' };
  if (manifest.lastModified && lastModified && manifest.lastModified !== lastModified) {
    return { ok: false, reason: 'Last-Modified mudou' };
  }
  if (manifest.lastModified && !lastModified) {
    return { ok: false, reason: 'Last-Modified antigo existe mas o servidor nao enviou validator agora' };
  }
  return { ok: true };
}

async function persistPartCompletion(manifestPath, manifest, range) {
  const part = manifest.parts.find((item) => item.index === range.index);
  if (!part) return false;
  part.completed = true;
  part.size = range.end - range.start + 1;
  return savePartManifest(manifestPath, manifest);
}

function isRetryablePartError(err) {
  if (!err) return false;
  if (err instanceof CancelledError) return false;
  if (err instanceof RateLimitError) return true;
  if (err instanceof NetworkError) return true;
  if (err?.name === 'AbortError') return true;
  if (typeof err?.message === 'string' && /fetch failed|timeout|socket|network|reset|econn|undici|terminated/i.test(err.message)) {
    return true;
  }
  return err?.retryable === true;
}

async function downloadToPartFile({ url, headers, range, partPath, onBytes, signal }) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...headers, Range: `bytes=${range.start}-${range.end}` },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (signal?.aborted) throw new CancelledError('Operacao cancelada.');
    if (res.status === 403) throw new ForbiddenError('HTTP 403 ao baixar parte.', { status: 403 });
    if (res.status === 429) throw new RateLimitError('HTTP 429 ao baixar parte.', { status: 429 });
    if (res.status >= 500) throw new NetworkError(`HTTP ${res.status} ao baixar parte.`, { status: res.status, retryable: true });
    if (res.status !== 206 || !res.body) {
      throw new StreamGrabError('Servidor nao respondeu 206 para a parte solicitada.', { code: 'RANGE_UNSUPPORTED' });
    }

    const contentRange = res.headers.get('content-range') || '';
    const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange.trim());
    if (!match || Number(match[1]) !== range.start || Number(match[2]) !== range.end) {
      throw new StreamGrabError(`Content-Range invalido para a parte (${contentRange || 'ausente'}).`, {
        code: 'INVALID_CONTENT_RANGE',
      });
    }

    const out = await fs.promises.open(partPath, 'w');
    try {
      const reader = res.body.getReader();
      let position = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (signal?.aborted) throw new CancelledError('Operacao cancelada.');
        if (done) break;
        if (value?.byteLength) {
          await out.write(value, 0, value.byteLength, position);
          position += value.byteLength;
          onBytes(value.byteLength);
        }
      }
      const expected = range.end - range.start + 1;
      if (position !== expected) {
        throw new StreamGrabError(`Parte incompleta (esperado ${expected}, recebeu ${position}).`, {
          code: 'INCOMPLETE_RANGE',
        });
      }
    } finally {
      await out.close().catch(() => {});
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

async function downloadPartWithRetry({ retryLimit = PART_RETRY_LIMIT, io, ...params }) {
  let lastError = null;
  for (let attempt = 1; attempt <= retryLimit; attempt++) {
    try {
      await fs.promises.unlink(params.partPath).catch(() => {});
      await downloadToPartFile(params);
      return { ok: true, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (params.signal?.aborted || err instanceof CancelledError) throw err;
      if (!isRetryablePartError(err) || attempt >= retryLimit) throw err;
      const waitMs = PART_RETRY_BASE_DELAY_MS * attempt;
      io?.log?.(
        `[turbo] Parte ${params.range.index + 1} falhou (${err.message}). Tentando novamente ${attempt}/${retryLimit - 1} em ${waitMs}ms...`,
      );
      await delay(waitMs);
    }
  }
  throw lastError;
}

export async function downloadPartFiles({
  url,
  output,
  headers,
  totalBytes,
  etag,
  lastModified,
  concurrency,
  blockCount,
  io,
}) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    throw new StreamGrabError('Tamanho total desconhecido para download em partes.', { code: 'RANGE_SIZE_UNKNOWN' });
  }

  const partsDir = createPartsDir(output);
  const manifestPath = createPartManifestPath(output);
  await fs.promises.mkdir(partsDir, { recursive: true });

  const ranges = computeRanges(totalBytes, blockCount);
  let manifest = loadPartManifest(manifestPath);
  const manifestStatus = validatePartManifest(manifest, { url, totalBytes, etag, lastModified, blockCount: ranges.length });
  if (!manifestStatus.ok) {
    if (manifest) {
      io.log(`[resume] Manifest antigo descartado: ${manifestStatus.reason}.`);
      await cleanupPartArtifacts(output);
      await fs.promises.mkdir(partsDir, { recursive: true });
    }
    manifest = createPartManifest({ url, output, totalBytes, etag, lastModified, ranges });
    await savePartManifest(manifestPath, manifest);
  } else {
    io.log('[resume] Reutilizando partes existentes validadas pelo manifest.');
  }

  const progress = createProgressReporter(io, { totalBytes, label: 'Arquivo' });
  let downloaded = 0;

  for (const range of ranges) {
    const partPath = createPartPath(partsDir, range.index);
    const expected = range.end - range.start + 1;
    const manifestPart = manifest.parts.find((item) => item.index === range.index);
    try {
      const stat = await fs.promises.stat(partPath);
      if (stat.size === expected && manifestPart?.completed) {
        downloaded += expected;
      } else {
        await fs.promises.unlink(partPath).catch(() => {});
        if (manifestPart) {
          manifestPart.completed = false;
          manifestPart.size = 0;
        }
      }
    } catch {
      if (manifestPart) {
        manifestPart.completed = false;
        manifestPart.size = 0;
      }
    }
  }
  await savePartManifest(manifestPath, manifest);
  progress.update({ key: 'total_size', value: downloaded });

  const pending = ranges.filter((range) => {
    const manifestPart = manifest.parts.find((item) => item.index === range.index);
    if (!manifestPart?.completed) return true;
    const partPath = createPartPath(partsDir, range.index);
    try {
      const stat = fs.statSync(partPath);
      return stat.size !== range.end - range.start + 1;
    } catch {
      return true;
    }
  });

  const abort = new AbortController();
  let activeConcurrency = Math.min(concurrency, pending.length || 1);
  let downgradeCount = 0;
  let failed = null;
  let failedRange = null;

  const workers = Array.from({ length: Math.min(concurrency, pending.length || 1) }, (_, workerIndex) => (async () => {
    while (!abort.signal.aborted) {
      if (workerIndex >= activeConcurrency) {
        await delay(PART_IDLE_WAIT_MS);
        continue;
      }
      const current = pending.shift();
      if (!current) break;
      const partPath = createPartPath(partsDir, current.index);
      try {
        await downloadPartWithRetry({
          url,
          headers,
          range: current,
          partPath,
          io,
          signal: abort.signal,
          onBytes(bytes) {
            downloaded += bytes;
            progress.update({ key: 'total_size', value: downloaded });
          },
        });
        await persistPartCompletion(manifestPath, manifest, current);
      } catch (err) {
        if (!abort.signal.aborted && isRetryablePartError(err) && activeConcurrency > 1 && downgradeCount < MAX_CONCURRENCY_DOWNGRADES) {
          const nextConcurrency = Math.max(1, Math.floor(activeConcurrency / 2));
          if (nextConcurrency < activeConcurrency) {
            downgradeCount += 1;
            activeConcurrency = nextConcurrency;
            pending.unshift(current);
            io.log(
              `[turbo] Instabilidade detectada na parte ${current.index + 1}. Reduzindo concorrencia para ${activeConcurrency} e recolocando a parte na fila.`,
            );
            await delay(PART_RETRY_BASE_DELAY_MS * downgradeCount);
            continue;
          }
        }
        if (!failed) {
          failed = err;
          failedRange = current;
        }
        abort.abort();
        break;
      }
    }
  })());

  await Promise.all(workers);
  progress.finish(!failed);

  if (failed) {
    const detail = failedRange ? `parte ${failedRange.index + 1} (${failedRange.start}-${failedRange.end})` : 'parte desconhecida';
    throw new StreamGrabError(`Falha em ${detail}: ${failed.message}`, {
      code: failed.code || 'PART_DOWNLOAD_FAILED',
      cause: failed,
    });
  }

  await mergePartFiles(partsDir, ranges, output);
  const mergedStat = await fs.promises.stat(output).catch(() => null);
  if (!mergedStat || mergedStat.size !== totalBytes) {
    throw new StreamGrabError(`Merge final invalido (esperado ${totalBytes}, recebeu ${mergedStat?.size || 0}).`, {
      code: 'INVALID_MERGE_SIZE',
    });
  }
  await cleanupPartArtifacts(output);
  return { ok: true, output, partCount: ranges.length };
}
