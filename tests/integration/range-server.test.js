// Integration: range server local + fallback de transport.
//
// Cobre (plano §28 - Integration):
//  - range server local (download paralelo via HTTP Range)
//  - fallback de transport (servidor sem Range -> { ok:false, error:'no-range' })
//  - falha de criação de arquivo -> { ok:false, error:'other' }
//  - cancelamento (abort) -> { ok:false, interrupted:true } + limpeza do parcial
//
// Sem dependência de rede externa nem de FFmpeg.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { runTurboDownloadFlow, DEFAULT_TURBO_CHUNKS } from '../../src/cli/turbo.js';

function makeCtx() {
  const logs = [];
  return {
    io: { log: (...a) => logs.push(a.join(' ')) },
    logs,
  };
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

test('turbo: range server suporta Range e baixa em multiplas conexoes', async () => {
  const content = Buffer.alloc(1000);
  for (let i = 0; i < content.length; i++) content[i] = i % 251;

  const { server, port } = await startServer((req, res) => {
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
      'Accept-Ranges': 'bytes',
    });
    res.end(content.subarray(start, end + 1));
  });

  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-range-')), 'out.mp4');
  try {
    const ctx = makeCtx();
    const result = await runTurboDownloadFlow(ctx, {
      url: `http://127.0.0.1:${port}/file.bin`,
      output,
      chunkCount: DEFAULT_TURBO_CHUNKS,
    });
    assert.equal(result.ok, true, 'turbo deve concluir com ok:true');
    assert.equal(result.error, undefined);
    const written = fs.readFileSync(output);
    assert.deepEqual(written, content, 'conteudo baixado por partes deve ser identico ao original');
    assert.ok(ctx.logs.some((l) => l.includes('8 conexoes paralelas')), 'log deve citar as 8 conexoes');
  } finally {
    await stopServer(server);
  }
});

test('turbo: servidor sem Range -> fallback de transport (no-range)', async () => {
  const content = Buffer.from('x'.repeat(500));
  const { server, port } = await startServer((req, res) => {
    // ignora o header Range de proposito
    res.writeHead(200, { 'Content-Length': content.length });
    res.end(content);
  });

  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-norange-')), 'out.mp4');
  try {
    const ctx = makeCtx();
    const result = await runTurboDownloadFlow(ctx, {
      url: `http://127.0.0.1:${port}/file.bin`,
      output,
      chunkCount: 8,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'no-range', 'sem Range o chamador deve cair no fluxo FFmpeg normal');
    assert.equal(fs.existsSync(output), false, 'nao deve criar arquivo parcial');
  } finally {
    await stopServer(server);
  }
});

test('turbo: falha ao criar o arquivo final -> other', async () => {
  const content = Buffer.alloc(64, 7);
  const { server, port } = await startServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : content.length - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${content.length}`,
        'Content-Length': end - start + 1,
      });
      res.end(content.subarray(start, end + 1));
    } else {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
    }
  });

  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-other-')), 'nao-existe', 'out.mp4');
  try {
    const ctx = makeCtx();
    const result = await runTurboDownloadFlow(ctx, {
      url: `http://127.0.0.1:${port}/file.bin`,
      output,
      chunkCount: 8,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'other', 'falha de escrita deve resultar em error other');
  } finally {
    await stopServer(server);
  }
});

test('turbo: cancelamento via AbortSignal -> interrupted + limpeza do parcial', async () => {
  // 1 MiB e o servidor atrasa cada chunk para garantir que o abort chega no meio.
  const content = Buffer.alloc(1024 * 1024, 3);
  const { server, port } = await startServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : content.length - 1;
      setTimeout(() => {
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${content.length}`,
          'Content-Length': end - start + 1,
        });
        res.end(content.subarray(start, end + 1));
      }, 80);
    } else {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
    }
  });

  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-abort-')), 'out.mp4');
  try {
    const ctx = makeCtx();
    const ac = new AbortController();
    const promise = runTurboDownloadFlow(ctx, {
      url: `http://127.0.0.1:${port}/file.bin`,
      output,
      chunkCount: 8,
      signal: ac,
    });
    setTimeout(() => ac.abort(), 120);
    const result = await promise;
    assert.equal(result.ok, false);
    assert.equal(result.interrupted, true, 'abort deve resultar em interrupted:true');
    assert.equal(fs.existsSync(output), false, 'parcial deve ser removido no cancelamento');
  } finally {
    await stopServer(server);
  }
});

test('turbo: DEFAULT_TURBO_CHUNKS congelado em 8', () => {
  assert.equal(DEFAULT_TURBO_CHUNKS, 8);
});
