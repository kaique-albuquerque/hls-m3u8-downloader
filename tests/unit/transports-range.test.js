// P4 — transports/range: download paralelo por partes + validacao de Range.
//
// Cobre (plano §16/§41):
//  - download paralelo com conteudo identico ao original
//  - limite de concorrencia (concurrency) respeitado
//  - servidor sem Range -> RANGE_UNSUPPORTED (fallback p/ http no strategy)
//  - Content-Range com offset errado -> INVALID_CONTENT_RANGE
//  - HTML no lugar de midia -> NOT_MEDIA
//  - 429 -> RateLimitError; 403 -> ForbiddenError
//  - abort -> CancelledError

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { downloadParallelRanges, probeRangeSupport, DEFAULT_RANGE_CHUNKS } from '../../src/transports/range.js';
import { CancelledError, ForbiddenError, RateLimitError } from '../../src/core/errors.js';

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function tmpOutput(prefix) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'out.mp4');
}

function rangeHandler(content) {
  return (req, res) => {
    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
      return;
    }
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : content.length - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${content.length}`,
      'Content-Length': end - start + 1,
    });
    res.end(content.subarray(start, end + 1));
  };
}

test('DEFAULT_RANGE_CHUNKS congelado em 8', () => {
  assert.equal(DEFAULT_RANGE_CHUNKS, 8);
});

test('downloadParallelRanges: conteudo identico ao original', async () => {
  const content = Buffer.alloc(2000);
  for (let i = 0; i < content.length; i++) content[i] = i % 251;

  const { server, port } = await startServer(rangeHandler(content));
  const output = tmpOutput('vd-range-ok-');
  try {
    const result = await downloadParallelRanges({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      chunkCount: 8,
    });
    assert.equal(result.ok, true);
    assert.equal(result.totalBytes, content.length);
    assert.deepEqual(fs.readFileSync(output), content, 'partes montadas devem ser identicas ao original');
  } finally {
    await stopServer(server);
  }
});

test('downloadParallelRanges: respeita o limite de concorrencia', async () => {
  const content = Buffer.alloc(4000, 3);
  let maxInFlight = 0;
  let inFlight = 0;

  const { server, port } = await startServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
      return;
    }
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : content.length - 1;
    setTimeout(() => {
      inFlight--;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${content.length}`,
        'Content-Length': end - start + 1,
      });
      res.end(content.subarray(start, end + 1));
    }, 15);
  });

  const output = tmpOutput('vd-range-conc-');
  try {
    await downloadParallelRanges({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      chunkCount: 8,
      concurrency: 2,
    });
    assert.ok(maxInFlight <= 2, `concorrencia estourou o limite: ${maxInFlight}`);
  } finally {
    await stopServer(server);
  }
});

test('probeRangeSupport: servidor sem Range -> RANGE_UNSUPPORTED', async () => {
  const content = Buffer.alloc(500, 7);
  const { server, port } = await startServer((req, res) => {
    // ignora Range de proposito
    res.writeHead(200, { 'Content-Length': content.length });
    res.end(content);
  });

  try {
    await assert.rejects(
      probeRangeSupport(`http://127.0.0.1:${port}/f.mp4`),
      (err) => err.code === 'RANGE_UNSUPPORTED'
    );
  } finally {
    await stopServer(server);
  }
});

test('downloadParallelRanges: servidor sem Range -> RANGE_UNSUPPORTED e nao cria arquivo', async () => {
  const content = Buffer.alloc(500, 7);
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': content.length });
    res.end(content);
  });

  const output = tmpOutput('vd-range-norange-');
  try {
    await assert.rejects(
      downloadParallelRanges({ url: `http://127.0.0.1:${port}/f.mp4`, output }),
      (err) => err.code === 'RANGE_UNSUPPORTED'
    );
    assert.equal(fs.existsSync(output), false);
  } finally {
    await stopServer(server);
  }
});

test('downloadParallelRanges: Content-Range com offset errado -> INVALID_CONTENT_RANGE', async () => {
  const content = Buffer.alloc(1000, 4);
  const { server, port } = await startServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
      return;
    }
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : content.length - 1;
    // Responde com offset errado (start+1) para qualquer parte.
    const wrongStart = start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${wrongStart}-${end}/${content.length}`,
      'Content-Length': end - wrongStart + 1,
    });
    res.end(content.subarray(wrongStart, end + 1));
  });

  const output = tmpOutput('vd-range-badcr-');
  try {
    await assert.rejects(
      downloadParallelRanges({ url: `http://127.0.0.1:${port}/f.mp4`, output }),
      (err) => err.code === 'INVALID_CONTENT_RANGE'
    );
  } finally {
    await stopServer(server);
  }
});

test('downloadParallelRanges: HTML no lugar de midia -> NOT_MEDIA', async () => {
  const content = Buffer.from('<html><body>login</body></html>');
  const { server, port } = await startServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': content.length });
      res.end(content);
      return;
    }
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : content.length - 1;
    res.writeHead(206, {
      'Content-Type': 'text/html',
      'Content-Range': `bytes ${start}-${end}/${content.length}`,
      'Content-Length': end - start + 1,
    });
    res.end(content.subarray(start, end + 1));
  });

  const output = tmpOutput('vd-range-html-');
  try {
    await assert.rejects(
      downloadParallelRanges({ url: `http://127.0.0.1:${port}/f.mp4`, output }),
      (err) => err.code === 'NOT_MEDIA'
    );
  } finally {
    await stopServer(server);
  }
});

test('downloadParallelRanges: 429 -> RateLimitError com retryAfter', async () => {
  const content = Buffer.alloc(1000, 6);
  const { server, port } = await startServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
      return;
    }
    res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '3' });
    res.end('rate limited');
  });

  const output = tmpOutput('vd-range-429-');
  try {
    await assert.rejects(
      downloadParallelRanges({ url: `http://127.0.0.1:${port}/f.mp4`, output }),
      (err) => err instanceof RateLimitError && String(err.retryAfter) === '3'
    );
  } finally {
    await stopServer(server);
  }
});

test('downloadParallelRanges: 403 -> ForbiddenError (terminal, sem fallback)', async () => {
  const content = Buffer.alloc(1000, 8);
  const { server, port } = await startServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
      return;
    }
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
  });

  const output = tmpOutput('vd-range-403-');
  try {
    await assert.rejects(
      downloadParallelRanges({ url: `http://127.0.0.1:${port}/f.mp4`, output }),
      (err) => err instanceof ForbiddenError
    );
  } finally {
    await stopServer(server);
  }
});

test('downloadParallelRanges: abort -> CancelledError', async () => {
  const content = Buffer.alloc(1024 * 1024, 2);
  const { server, port } = await startServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
      return;
    }
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : content.length - 1;
    setTimeout(() => {
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${content.length}`,
        'Content-Length': end - start + 1,
      });
      res.end(content.subarray(start, end + 1));
    }, 80);
  });

  const output = tmpOutput('vd-range-abort-');
  const ac = new AbortController();
  try {
    const p = downloadParallelRanges({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      chunkCount: 8,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 40);
    await assert.rejects(p, (err) => err instanceof CancelledError);
  } finally {
    await stopServer(server);
  }
});

test('downloadParallelRanges: progresso reportado', async () => {
  const content = Buffer.alloc(1000, 9);
  const { server, port } = await startServer(rangeHandler(content));
  const output = tmpOutput('vd-range-prog-');
  const seen = [];
  try {
    await downloadParallelRanges({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      chunkCount: 8,
      onProgress: (u) => seen.push(u),
    });
    assert.ok(seen.length >= 1);
    const last = seen[seen.length - 1];
    assert.equal(last.totalBytes, content.length);
    assert.equal(last.bytesDownloaded, content.length);
  } finally {
    await stopServer(server);
  }
});
