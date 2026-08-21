export const DEFAULT_TURBO_CHUNKS = 8;
export const MAX_TURBO_CHUNKS = 1024;

export function normalizeChunkCount(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_TURBO_CHUNKS;
  return Math.min(parsed, MAX_TURBO_CHUNKS);
}

export function normalizeBlockCount(totalBytes, concurrency, blockCount) {
  const safeConcurrency = Math.max(1, Math.floor(concurrency || DEFAULT_TURBO_CHUNKS));
  const requested = Number(blockCount);
  if (Number.isInteger(requested) && requested >= safeConcurrency) return requested;
  const baseline = safeConcurrency * 8;
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return baseline;
  const minBlockSize = 8 * 1024 * 1024;
  const maxBySize = Math.max(safeConcurrency, Math.ceil(totalBytes / minBlockSize));
  return Math.max(safeConcurrency, Math.min(baseline, maxBySize));
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

export function planFileDownload({
  totalBytes = 0,
  capability = 'NO_RANGE',
  userConcurrency = 0,
  userBlockCount = 0,
} = {}) {
  const concurrency = normalizeChunkCount(userConcurrency);
  if (!(Number.isFinite(totalBytes) && totalBytes > 0)) {
    return { mode: 'sequential', concurrency: 1, blockCount: 0, rationale: ['tamanho desconhecido'] };
  }
  if (capability !== 'FULL_RANGE') {
    return { mode: 'sequential', concurrency: 1, blockCount: 0, rationale: [`capability=${capability}`] };
  }
  const blockCount = normalizeBlockCount(totalBytes, concurrency, userBlockCount || 0);
  return {
    mode: 'multipart',
    concurrency,
    blockCount,
    rationale: ['range confirmado', `concurrency=${concurrency}`, `blockCount=${blockCount}`],
  };
}
