// Integration: Smart Turbo (P6.2) — pool dinamico com servidores locais.
//
// Cobre (plano §28 - Integration + secao 14):
//  - servidor com throttle agregado -> concurrency REDUZ (backoff) e o
//    download completa com conteudo integro (nao induz 403/429).
//  - servidor normal -> concurrency CRESCE (rampa) ate o max.
//  - smartTurbo: false -> pool fixo antigo (rollback por config): nenhuma
//    decisao e emitida e o download funciona como antes.
//
// Sem dependencia de rede externa nem de FFmpeg.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { downloadParallelRanges } from '../../src/transports/range.js';

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** Content deterministico (repeticao de padrao) para hash/verificacao. */
function makeContent(size) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 31 + 7) % 251;
  return buf;
}

/**
 * Servidor Range com throttle AGREGADO (token bucket FIFO): o total baixado
 * por segundo fica ~constante em qualquer concurrency — mesmo cenario do
 * baseline `throttle-1MBps` (perConn cai forte, total estagna).
 */
function startThrottleServer({ content, throttleBps, latencyMs = 0 }) {
  let bucket = 0;
  const waiters = [];
  const refill = setInterval(() => {
    // Sem cap: o bucket precisa acumular tokens suficientes para o chunk
    // maior; com cap menor que o chunk, os waiters nunca seriam liberados.
    bucket += throttleBps * 0.05;
    while (waiters.length && bucket >= waiters[0].bytes) {
      const w = waiters.shift();
      bucket -= w.bytes;
      w.resolve();
    }
  }, 50);
  const stats = { requests: 0, status429: 0, status403: 0 };

  const server = http.createServer((req, res) => {
    stats.requests++;
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
      return;
    }
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : content.length - 1;
    const chunk = content.subarray(start, end + 1);
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${content.length}`,
      'Content-Length': chunk.length,
      'Accept-Ranges': 'bytes',
    });
    const send = () => {
      if (latencyMs > 0) setTimeout(() => res.end(chunk), latencyMs);
      else res.end(chunk);
    };
    if (bucket >= chunk.length) {
      bucket -= chunk.length;
      send();
    } else {
      waiters.push({ bytes: chunk.length, resolve: send });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, stats, stop: () => clearInterval(refill) });
    });
  });
}

test('smart-turbo: throttle agregado -> concurrency reduz e download completa integro', async () => {
  const content = makeContent(2 * 1024 * 1024); // 2 MiB
  const { server, stats, stop } = await startThrottleServer({ content, throttleBps: 1024 * 1024 }); // 1 MB/s
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-st-throttle-')), 'out.mp4');
  const decisions = [];
  try {
    const result = await downloadParallelRanges({
      url: `http://127.0.0.1:${server.address().port}/file.bin`,
      output,
      chunkCount: 16,
      smartTurbo: { windowMs: 80, max: 8 },
      onTurboDecision: (d) => decisions.push(d),
    });
    assert.equal(result.ok, true, 'download deve concluir mesmo com throttle');
    assert.deepEqual(fs.readFileSync(output), content, 'conteudo integro');
    assert.ok(decisions.some((d) => d.action === 'down'), `esperava decisao down (recebido: ${decisions.map((d) => d.action).join(',')})`);
    const last = decisions[decisions.length - 1];
    assert.ok(last.concurrency <= 4, `concurrency final deve ser bem menor que max (recebido ${last.concurrency})`);
    assert.equal(stats.status429, 0, 'nenhum 429 induzido');
    assert.equal(stats.status403, 0, 'nenhum 403 induzido');
  } finally {
    await stopServer(server);
    stop();
  }
});

test('smart-turbo: servidor normal -> concurrency cresce (rampa) ate o max', async () => {
  const content = makeContent(8 * 1024 * 1024); // 8 MiB
  const { server, stop } = await startThrottleServer({ content, throttleBps: 1024 * 1024 * 1024, latencyMs: 20 }); // praticamente sem limite
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-st-normal-')), 'out.mp4');
  const decisions = [];
  try {
    const result = await downloadParallelRanges({
      url: `http://127.0.0.1:${server.address().port}/file.bin`,
      output,
      chunkCount: 16,
      smartTurbo: { windowMs: 50, max: 8 },
      onTurboDecision: (d) => decisions.push(d),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(fs.readFileSync(output), content, 'conteudo integro');
    assert.ok(decisions.some((d) => d.action === 'up'), `esperava decisao up (recebido: ${decisions.map((d) => d.action).join(',')})`);
    assert.ok(decisions.some((d) => d.action === 'hold'), 'esperava estabilizar no pico (hold)');
    assert.ok(decisions.every((d) => d.concurrency <= 8), 'nunca acima do max');
  } finally {
    await stopServer(server);
    stop();
  }
});

test('smart-turbo: rollback por config (smartTurbo: false) mantem pool fixo sem decisoes', async () => {
  const content = makeContent(512 * 1024);
  const { server, stop } = await startThrottleServer({ content, throttleBps: 1024 * 1024 * 1024 });
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-st-off-')), 'out.mp4');
  const decisions = [];
  try {
    const result = await downloadParallelRanges({
      url: `http://127.0.0.1:${server.address().port}/file.bin`,
      output,
      chunkCount: 8,
      concurrency: 4,
      smartTurbo: false,
      onTurboDecision: (d) => decisions.push(d),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(fs.readFileSync(output), content, 'conteudo integro');
    assert.equal(decisions.length, 0, 'smartTurbo desligado nao emite decisoes');
  } finally {
    await stopServer(server);
    stop();
  }
});
