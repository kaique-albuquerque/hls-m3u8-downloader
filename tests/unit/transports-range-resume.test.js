// P6.1 — transports/range: resume end-to-end (plano §13).
//
// Cenarios (criterios de aceite do plano):
//  (a) interromper (abort) -> parcial + sidecar -> retomar -> hash identico
//      ao download limpo; sidecar removido apos sucesso.
//  (b) recurso remoto mudou (ETag novo) -> parcial descartado, recomeca
//      limpo com o conteudo NOVO (nunca concatena dados antigos).
//  (c) resume:false (--no-resume) -> sem sidecar (rollback: truncate antigo).
//  (d) URL assinada expirada (403 no probe) -> reanalise unica via
//      onExpiredUrl -> retoma da URL nova com validators coincidentes.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { downloadParallelRanges } from '../../src/transports/range.js';
import { CancelledError } from '../../src/core/errors.js';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function makeContent(size, seed) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 31 + seed * 7) % 251;
  return buf;
}

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

/** Handler com suporte a Range + ETag/Last-Modified opcionais + delay por chunk. */
function rangeHandler(content, { etag = null, lastModified = null, delayMs = 0 } = {}) {
  return (req, res) => {
    const send = (status, headers, body) => {
      if (etag) headers.ETag = etag;
      if (lastModified) headers['Last-Modified'] = lastModified;
      const respond = () => {
        res.writeHead(status, headers);
        res.end(body);
      };
      if (delayMs > 0) setTimeout(respond, delayMs);
      else respond();
    };
    const range = req.headers.range;
    if (!range) {
      send(200, { 'Content-Length': content.length }, content);
      return;
    }
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : content.length - 1;
    send(
      206,
      {
        'Content-Range': `bytes ${start}-${end}/${content.length}`,
        'Content-Length': end - start + 1,
      },
      content.subarray(start, end + 1)
    );
  };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-resume-'));
  return {
    output: path.join(dir, 'out.mp4'),
    statePath: path.join(dir, 'out.mp4.resume.json'),
    dir,
  };
}

// Tamanho: 8 chunks de 32 KiB = 256 KiB. Abort progressivo dispara ao
// completar 2 chunks (deterministico, independente de timing do event loop).
const CHUNK_SIZE = 32 * 1024;
const TOTAL = 8 * CHUNK_SIZE;

test('P6.1 (a): interromper -> retomar -> hash identico; sidecar removido', async () => {
  const content = makeContent(TOTAL, 1);
  const { server, port } = await startServer(rangeHandler(content, { etag: '"v1"', delayMs: 60 }));
  const { output, statePath, dir } = setup();
  const clean = path.join(dir, 'clean.mp4');
  try {
    // Referencia: download limpo (sem interrupcao).
    await downloadParallelRanges({ url: `http://127.0.0.1:${port}/f.mp4`, output: clean, chunkCount: 8 });
    const cleanHash = sha256(fs.readFileSync(clean));

    // Run 1: aborta apos 2 chunks completos -> parcial + sidecar.
    const ac = new AbortController();
    const events = [];
    const p1 = downloadParallelRanges({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      chunkCount: 8,
      concurrency: 2,
      signal: ac.signal,
      onResume: (e) => events.push(e),
      onProgress: (u) => {
        if (u.bytesDownloaded >= 2 * CHUNK_SIZE && !ac.signal.aborted) ac.abort();
      },
    });
    await assert.rejects(p1, (err) => err instanceof CancelledError);

    assert.ok(events.some((e) => e.action === 'fresh'), 'run 1 deve criar estado (fresh)');
    assert.equal(fs.existsSync(statePath), true, 'sidecar deve existir apos abort');
    assert.equal(fs.statSync(output).size, TOTAL, 'parcial deve ter tamanho total (truncado)');

    // As partes 0 e 1 foram gravadas corretamente no parcial.
    const partial = fs.readFileSync(output);
    assert.deepEqual(partial.subarray(0, CHUNK_SIZE), content.subarray(0, CHUNK_SIZE), 'chunk 0 no parcial');
    assert.deepEqual(
      partial.subarray(CHUNK_SIZE, 2 * CHUNK_SIZE),
      content.subarray(CHUNK_SIZE, 2 * CHUNK_SIZE),
      'chunk 1 no parcial'
    );

    // Run 2: retoma (resume por default) -> completa os chunks restantes.
    const events2 = [];
    const r2 = await downloadParallelRanges({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      chunkCount: 8,
      concurrency: 2,
      onResume: (e) => events2.push(e),
    });
    assert.equal(r2.ok, true);
    const resumeEvent = events2.find((e) => e.action === 'resume');
    assert.ok(resumeEvent, 'run 2 deve retomar');
    assert.ok(resumeEvent.resumedBytes >= CHUNK_SIZE, `deve retomar >= 1 chunk (${resumeEvent.resumedBytes})`);
    assert.equal(fs.existsSync(statePath), false, 'sidecar removido apos sucesso');

    assert.equal(sha256(fs.readFileSync(output)), cleanHash, 'hash final identico ao download limpo');
  } finally {
    await stopServer(server);
  }
});

test('P6.1 (b): recurso mudou (ETag novo) -> parcial descartado, recomeca limpo', async () => {
  const v1 = makeContent(TOTAL, 1);
  const v2 = makeContent(TOTAL, 2);
  let current = v1;
  let etag = '"v1"';
  const { server, port } = await startServer((req, res) =>
    rangeHandler(current, { etag, delayMs: 60 })(req, res)
  );
  const { output, statePath } = setup();
  try {
    // Run 1: parcial com ETag v1.
    const ac = new AbortController();
    const p1 = downloadParallelRanges({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      chunkCount: 8,
      concurrency: 2,
      signal: ac.signal,
      onProgress: (u) => {
        if (u.bytesDownloaded >= 2 * CHUNK_SIZE && !ac.signal.aborted) ac.abort();
      },
    });
    await assert.rejects(p1, (err) => err instanceof CancelledError);
    assert.equal(fs.existsSync(statePath), true, 'sidecar (ETag v1) existe');

    // Recurso remoto muda (novo conteudo + ETag).
    current = v2;
    etag = '"v2"';

    // Run 2: probe ve ETag novo -> discard -> baixa o conteudo NOVO do zero.
    const events = [];
    const r2 = await downloadParallelRanges({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      chunkCount: 8,
      concurrency: 2,
      onResume: (e) => events.push(e),
    });
    assert.equal(r2.ok, true);
    assert.ok(events.some((e) => e.action === 'discard'), 'deve descartar o parcial (ETag mudou)');
    assert.equal(fs.existsSync(statePath), false, 'sidecar removido apos sucesso');

    const finalHash = sha256(fs.readFileSync(output));
    assert.equal(finalHash, sha256(v2), 'resultado deve ser o conteudo NOVO');
    assert.notEqual(finalHash, sha256(v1), 'nao pode conter dados antigos');
  } finally {
    await stopServer(server);
  }
});

test('P6.1 (c): resume:false (--no-resume) -> sem sidecar (rollback antigo)', async () => {
  const content = makeContent(TOTAL, 3);
  const { server, port } = await startServer(rangeHandler(content, { delayMs: 60 }));
  const { output, statePath, dir } = setup();
  const clean = path.join(dir, 'clean.mp4');
  try {
    await downloadParallelRanges({ url: `http://127.0.0.1:${port}/f.mp4`, output: clean, chunkCount: 8, resume: false });
    const cleanHash = sha256(fs.readFileSync(clean));

    // Interrupcao com resume:false -> parcial fica (limpeza e do fluxo), sidecar NAO.
    const ac = new AbortController();
    const p1 = downloadParallelRanges({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      chunkCount: 8,
      concurrency: 2,
      resume: false,
      signal: ac.signal,
      onProgress: (u) => {
        if (u.bytesDownloaded >= 2 * CHUNK_SIZE && !ac.signal.aborted) ac.abort();
      },
    });
    await assert.rejects(p1, (err) => err instanceof CancelledError);
    assert.equal(fs.existsSync(statePath), false, 'resume:false nao cria sidecar');

    // Re-execucao com resume:false -> truncate + download completo.
    const r2 = await downloadParallelRanges({
      url: `http://127.0.0.1:${port}/f.mp4`,
      output,
      chunkCount: 8,
      resume: false,
    });
    assert.equal(r2.ok, true);
    assert.equal(sha256(fs.readFileSync(output)), cleanHash, 'hash identico ao limpo');
    assert.equal(fs.existsSync(statePath), false);
  } finally {
    await stopServer(server);
  }
});

test('P6.1 (d): URL assinada expirada (403) -> reanalise unica -> retoma da URL nova', async () => {
  const content = makeContent(TOTAL, 4);
  let expiredA = false;
  const handlerA = (req, res) => {
    if (expiredA) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('signed url expired');
      return;
    }
    return rangeHandler(content, { etag: '"v1"', delayMs: 60 })(req, res);
  };
  const { server: serverA, port: portA } = await startServer(handlerA);
  const { server: serverB, port: portB } = await startServer(rangeHandler(content, { etag: '"v1"', delayMs: 60 }));
  const urlA = `http://127.0.0.1:${portA}/f.mp4`;
  const urlB = `http://127.0.0.1:${portB}/f.mp4`;
  const { output, statePath } = setup();
  try {
    // Run 1: parcial via URL-A (2 chunks, ETag v1).
    const ac = new AbortController();
    const p1 = downloadParallelRanges({
      url: urlA,
      output,
      chunkCount: 8,
      concurrency: 2,
      signal: ac.signal,
      onProgress: (u) => {
        if (u.bytesDownloaded >= 2 * CHUNK_SIZE && !ac.signal.aborted) ac.abort();
      },
    });
    await assert.rejects(p1, (err) => err instanceof CancelledError);
    assert.equal(fs.existsSync(statePath), true);

    // A assinatura da URL-A vence: qualquer requisicao agora responde 403.
    expiredA = true;

    // Run 2: probe 403 -> reanalise via onExpiredUrl -> retoma da URL-B.
    const events = [];
    let resolveCalls = 0;
    const r2 = await downloadParallelRanges({
      url: urlA,
      output,
      chunkCount: 8,
      concurrency: 2,
      onResume: (e) => events.push(e),
      onExpiredUrl: async () => {
        resolveCalls++;
        return { url: urlB };
      },
    });
    assert.equal(r2.ok, true);
    assert.equal(resolveCalls, 1, 'reanalise deve acontecer no maximo 1x');
    assert.ok(events.some((e) => e.action === 'reanalyze'), 'deve reportar reanalise');
    assert.ok(events.some((e) => e.action === 'resume'), 'deve retomar apos renovar a URL');
    assert.equal(fs.existsSync(statePath), false, 'sidecar removido apos sucesso');
    assert.equal(sha256(fs.readFileSync(output)), sha256(content), 'conteudo identico ao esperado');
  } finally {
    await stopServer(serverA);
    await stopServer(serverB);
  }
});
