// P4 — transports/http: download sequencial + deteccao de Accept-Ranges.
//
// Cobre (plano §16/§41):
//  - download sequencial completo (conteudo identico)
//  - detectAcceptRanges: 206 + Content-Range -> aceita; 200 -> nao aceita
//  - resposta HTML/JSON no lugar de midia -> NOT_MEDIA
//  - 403 -> ForbiddenError; 429 -> RateLimitError com retryAfter
//  - cancelamento -> CancelledError
//  - timeout -> NetworkError retryable

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { downloadSequential, detectAcceptRanges, isNotMediaResponse, looksLikeHtml, looksLikeJson } from '../../src/transports/http.js';
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

test('isNotMediaResponse / looksLikeHtml / looksLikeJson: deteccao por content-type e sniff', () => {
  assert.equal(looksLikeHtml('<html><body>x</body></html>'), true);
  assert.equal(looksLikeJson('{"error": true}'), true);
  assert.equal(isNotMediaResponse('text/html', undefined), true);
  assert.equal(isNotMediaResponse('application/json', undefined), true);
  assert.equal(isNotMediaResponse('video/mp4', undefined), false);
  assert.equal(isNotMediaResponse('application/octet-stream', '<html>'), true, 'sniff de HTML deve vencer');
  assert.equal(isNotMediaResponse('', '{"a":1}'), true, 'sniff de JSON deve vencer');
  assert.equal(isNotMediaResponse('video/mp4', '<html>'), true, 'servidor que manda HTML com content-type de midia ainda e detectado');
});

test('downloadSequential: baixa o conteudo inteiro com sucesso', async () => {
  const content = Buffer.alloc(2048);
  for (let i = 0; i < content.length; i++) content[i] = i % 251;

  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': content.length, 'Content-Type': 'video/mp4' });
    res.end(content);
  });

  const output = tmpOutput('vd-http-ok-');
  try {
    const result = await downloadSequential({ url: `http://127.0.0.1:${port}/f.mp4`, output });
    assert.equal(result.ok, true);
    assert.equal(result.bytesDownloaded, content.length);
    assert.equal(result.totalBytes, content.length);
    assert.deepEqual(fs.readFileSync(output), content);
  } finally {
    await stopServer(server);
  }
});

test('downloadSequential: reporta progresso incremental', async () => {
  const content = Buffer.alloc(1024, 9);
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': content.length, 'Content-Type': 'video/mp4' });
    res.end(content);
  });

  const output = tmpOutput('vd-http-prog-');
  const seen = [];
  try {
    await downloadSequential({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      onProgress: (u) => seen.push(u),
    });
    assert.ok(seen.length >= 1, 'deve emitir pelo menos um progresso');
    const last = seen[seen.length - 1];
    assert.equal(last.bytesDownloaded, content.length);
    assert.equal(last.percent, 100);
  } finally {
    await stopServer(server);
  }
});

test('downloadSequential: HTML no lugar de midia -> NOT_MEDIA', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>pagina de login</body></html>');
  });

  const output = tmpOutput('vd-http-html-');
  try {
    await assert.rejects(
      downloadSequential({ url: `http://127.0.0.1:${port}/f.mp4`, output }),
      (err) => err.code === 'NOT_MEDIA'
    );
  } finally {
    await stopServer(server);
  }
});

test('downloadSequential: validateMedia=false aceita resposta nao-midia', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>ok</html>');
  });

  const output = tmpOutput('vd-http-raw-');
  try {
    const result = await downloadSequential({ url: `http://127.0.0.1:${port}/f.mp4`, output, validateMedia: false });
    assert.equal(result.ok, true);
  } finally {
    await stopServer(server);
  }
});

test('downloadSequential: 403 -> ForbiddenError (terminal)', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
  });

  const output = tmpOutput('vd-http-403-');
  try {
    await assert.rejects(
      downloadSequential({ url: `http://127.0.0.1:${port}/f.mp4`, output }),
      (err) => err instanceof ForbiddenError
    );
  } finally {
    await stopServer(server);
  }
});

test('downloadSequential: 429 -> RateLimitError com retryAfter', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '4' });
    res.end('rate limited');
  });

  const output = tmpOutput('vd-http-429-');
  try {
    await assert.rejects(
      downloadSequential({ url: `http://127.0.0.1:${port}/f.mp4`, output }),
      (err) => err instanceof RateLimitError && String(err.retryAfter) === '4'
    );
  } finally {
    await stopServer(server);
  }
});

test('downloadSequential: abort -> CancelledError', async () => {
  const content = Buffer.alloc(512 * 1024, 5);
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': content.length, 'Content-Type': 'video/mp4' });
    res.write(content.subarray(0, 1024));
    // mantem a conexao aberta para o abort chegar no meio do stream
    setTimeout(() => res.end(content.subarray(1024)), 500);
  });

  const output = tmpOutput('vd-http-abort-');
  const ac = new AbortController();
  try {
    const p = downloadSequential({ url: `http://127.0.0.1:${port}/f.mp4`, output, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await assert.rejects(p, (err) => err instanceof CancelledError || err?.code === 'CANCELLED');
  } finally {
    await stopServer(server);
  }
});

test('detectAcceptRanges: 206 com Content-Range -> acceptRanges:true + total', async () => {
  const content = Buffer.alloc(1000, 1);
  const { server, port } = await startServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : content.length - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${content.length}`,
      'Content-Length': end - start + 1,
    });
    res.end(content.subarray(start, end + 1));
  });

  try {
    const probe = await detectAcceptRanges(`http://127.0.0.1:${port}/f.mp4`);
    assert.equal(probe.ok, true);
    assert.equal(probe.acceptRanges, true);
    assert.equal(probe.total, content.length);
  } finally {
    await stopServer(server);
  }
});

test('detectAcceptRanges: servidor ignora Range (200) -> acceptRanges:false', async () => {
  const content = Buffer.alloc(100, 2);
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': content.length });
    res.end(content);
  });

  try {
    const probe = await detectAcceptRanges(`http://127.0.0.1:${port}/f.mp4`);
    assert.equal(probe.ok, true);
    assert.equal(probe.acceptRanges, false);
  } finally {
    await stopServer(server);
  }
});

test('detectAcceptRanges: 403 -> ForbiddenError', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
  });

  try {
    await assert.rejects(
      detectAcceptRanges(`http://127.0.0.1:${port}/f.mp4`),
      (err) => err instanceof ForbiddenError
    );
  } finally {
    await stopServer(server);
  }
});
