import { normalizeBlockCount } from '../transports/range.js';

export function planFileDownload({
  totalBytes = 0,
  capability = 'NO_RANGE',
  userConcurrency = 0,
  userBlockCount = 0,
  preset = 'auto',
} = {}) {
  const rationale = [];

  let concurrency = Number.isInteger(userConcurrency) && userConcurrency > 0 ? userConcurrency : 8;
  if (preset === 'conservative') concurrency = Math.min(concurrency, 8);
  if (preset === 'aggressive') concurrency = Math.max(concurrency, 16);
  if (preset === 'custom') concurrency = Math.max(1, concurrency);

  if (!(Number.isFinite(totalBytes) && totalBytes > 0)) {
    rationale.push('tamanho desconhecido -> modo sequencial');
    return {
      mode: 'sequential',
      capability,
      concurrency: 1,
      blockCount: 0,
      minBlockSize: 0,
      rationale,
    };
  }

  if (capability !== 'FULL_RANGE') {
    rationale.push(`capability ${capability} nao garante range confiavel -> modo sequencial`);
    return {
      mode: 'sequential',
      capability,
      concurrency: 1,
      blockCount: 0,
      minBlockSize: 0,
      rationale,
    };
  }

  const minBlockSize = 8 * 1024 * 1024;
  const blockCount = normalizeBlockCount(totalBytes, concurrency, userBlockCount || undefined);
  rationale.push(`range confirmado -> multipart`);
  rationale.push(`concurrency=${concurrency}`);
  rationale.push(`blockCount=${blockCount}`);
  if (userBlockCount > 0) rationale.push(`blockCount manual solicitado=${userBlockCount}`);
  rationale.push(`minBlockSize=${minBlockSize}`);

  return {
    mode: 'multipart',
    capability,
    concurrency,
    blockCount,
    minBlockSize,
    rationale,
  };
}
