import { normalizeHeaders } from '../utils.js';

function parseContentDispositionFilename(value) {
  const raw = String(value || '');
  const star = raw.match(/filename\*\s*=\s*([^;]+)/i);
  if (star) {
    const encoded = star[1].trim().replace(/^UTF-8''/i, '').replace(/^"(.*)"$/, '$1');
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const plain = raw.match(/filename\s*=\s*([^;]+)/i);
  if (!plain) return '';
  return plain[1].trim().replace(/^"(.*)"$/, '$1');
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    return '';
  }
}

async function requestProbe(url, { method, headers }) {
  const res = await fetch(url, {
    method,
    headers,
    redirect: 'follow',
  });
  try {
    const contentRange = res.headers.get('content-range') || '';
    const contentLength = Number(res.headers.get('content-length') || 0);
    const rangeMatch = contentRange.match(/\/(\d+|\*)$/);
    const totalBytes = rangeMatch && rangeMatch[1] !== '*' ? Number(rangeMatch[1]) : contentLength;

    return {
      ok: res.ok || res.status === 206,
      status: res.status,
      finalUrl: res.url || url,
      contentType: res.headers.get('content-type') || '',
      contentDisposition: res.headers.get('content-disposition') || '',
      acceptsRanges: res.status === 206 || /bytes/i.test(res.headers.get('accept-ranges') || ''),
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
      etag: res.headers.get('etag') || '',
      lastModified: res.headers.get('last-modified') || '',
    };
  } finally {
    await res.body?.cancel?.().catch(() => {});
  }
}

export function classifyFileCapability(probe) {
  if (probe.acceptsRanges && probe.totalBytes > 0 && probe.status === 206) return 'FULL_RANGE';
  if (probe.totalBytes > 0) return 'PARTIAL_METADATA';
  if (probe.ok) return 'NO_RANGE';
  return 'HOSTILE';
}

function capabilityScore(capability) {
  if (capability === 'FULL_RANGE') return 4;
  if (capability === 'PARTIAL_METADATA') return 3;
  if (capability === 'NO_RANGE') return 2;
  return 1;
}

export async function probeFileDownload(url, { headers = {} } = {}) {
  const normalized = normalizeHeaders({
    'Accept-Encoding': 'identity',
    ...headers,
  });

  const attempts = [
    { method: 'HEAD', headers: normalized, probeMethod: 'head' },
    { method: 'GET', headers: { ...normalized, Range: 'bytes=0-0' }, probeMethod: 'range-0-0' },
    { method: 'GET', headers: normalized, probeMethod: 'plain-get' },
  ];

  let lastError = null;
  let best = null;
  for (const attempt of attempts) {
    try {
      const result = await requestProbe(url, attempt);
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      const filename =
        parseContentDispositionFilename(result.contentDisposition) ||
        filenameFromUrl(result.finalUrl) ||
        filenameFromUrl(url) ||
        'arquivo.bin';
      const capability = classifyFileCapability(result);
      const metadataConfidence =
        capability === 'FULL_RANGE' ? 'high' : capability === 'PARTIAL_METADATA' ? 'medium' : 'low';
      const candidate = {
        ok: true,
        finalUrl: result.finalUrl,
        contentType: result.contentType,
        contentDisposition: result.contentDisposition,
        totalBytes: result.totalBytes,
        acceptsRanges: result.acceptsRanges,
        etag: result.etag,
        lastModified: result.lastModified,
        filename,
        probeMethod: attempt.probeMethod,
        capability,
        metadataConfidence,
      };
      if (capability === 'FULL_RANGE') return candidate;
      if (!best || capabilityScore(candidate.capability) > capabilityScore(best.capability)) {
        best = candidate;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (best) return best;
  if (lastError) throw lastError;
  throw new Error('Probe falhou sem detalhes.');
}
