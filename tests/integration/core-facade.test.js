// Integration: StreamGrabCore (fachada P2.4) com executor padrao real.
//
// Cobre (plano §P2.4 - Criterios):
//  - "CLI e um harness de teste consomem a mesma API": o harness chama
//    createStreamGrabCore() sem mocks e baixa um arquivo real de servidor local.
//  - Ciclo de vida completo emitindo eventos (start/progress/complete).
//  - Falha HTTP mapeada para a taxonomia da P2.2 (404 -> MediaNotFound).
//
// Sem rede externa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createStreamGrabCore } from '../../src/core/registry.js';
import { MediaNotFoundError } from '../../src/core/errors.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-it-core-'));
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const stop = () => new Promise((resolve) => server.close(resolve));
  return { port, stop, url: (p) => `http://127.0.0.1:${port}${p}` };
}

const PAYLOAD = Buffer.from('conteudo-real-do-arquivo-de-teste-streamgrab');

test('core-facade: download direto real completa com eventos de progresso', async () => {
  const tmp = makeTempDir();
  const { url, stop } = await startServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': PAYLOAD.length,
    });
    res.end(PAYLOAD);
  });
  try {
    const core = createStreamGrabCore({ progressThrottleMs: 0 });
    const seen = [];
    core.on('start', (p) => seen.push(['start', p]));
    core.on('progress', (p) => seen.push(['progress', p]));
    core.on('complete', (p) => seen.push(['complete', p]));

    const job = await core.download(url('/video.mp4'), { destination: tmp });

    assert.equal(job.state, 'completed');
    assert.ok(job.meta.output, 'output deve estar preenchido');
    assert.equal(fs.readFileSync(job.meta.output).toString(), PAYLOAD.toString());
    assert.ok(fs.statSync(job.meta.output).size > 0);

    const names = seen.map(([n]) => n);
    assert.ok(names.includes('start'));
    assert.ok(names.includes('progress'));
    assert.ok(names.includes('complete'));
    const progressPayloads = seen.filter(([n]) => n === 'progress').map(([, p]) => p);
    assert.ok(progressPayloads.length >= 1, 'deve haver progresso');
    const downloading = progressPayloads.find((p) => p.stage === 'downloading');
    assert.ok(downloading, 'progress deve ter stage downloading');
    assert.ok(downloading.bytesDownloaded > 0, 'bytesDownloaded deve crescer');
    assert.equal(downloading.totalBytes, PAYLOAD.length);
    assert.equal(downloading.jobId, job.id);
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('core-facade: HTTP 404 vira MediaNotFoundError e job falha com status', async () => {
  const tmp = makeTempDir();
  const { url, stop } = await startServer((req, res) => {
    res.writeHead(404);
    res.end('not found');
  });
  try {
    const core = createStreamGrabCore();
    const errors = [];
    core.on('error', (p) => errors.push(p));

    await assert.rejects(
      () => core.download(url('/ausente.mp4'), { destination: tmp }),
      (err) => err instanceof MediaNotFoundError
    );

    const failed = core.getHistory()[0];
    assert.equal(failed.state, 'failed');
    assert.equal(failed.error.code, 'MEDIA_NOT_FOUND_ERROR');
    assert.equal(failed.error.status, 404);
    assert.equal(errors.length, 1);
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
