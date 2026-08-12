// Integration: Electron → Core → Queue → Download (P11 itens 2-5, 9-10).
//
// Valida o fluxo REAL sem simulacao de prompts do CLI (sem runCliSession /
// createAnswerBook):
//  - electron/services.js monta Engine + StreamGrabCore + Queue + Settings +
//    History reais, compartilhando a MESMA instancia de engine;
//  - fila com limite de concorrencia, cancelar, pause/resume, retry;
//  - historico registrado e persistido entre reinicios;
//  - crash recovery: jobs em andamento voltam como `queued` ao reiniciar;
//  - applySettings ajusta maxConcurrentDownloads em tempo real e persiste;
//  - meta.filename define o nome de saida (item 1: a UI nao depende mais da
//    simulacao de prompts do CLI para definir destino/formato).
//
// Sem rede externa e sem importar electron/*.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createElectronServices } from '../../electron/services.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-it-eq-'));
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const stop = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  return { port, stop, url: (p) => `http://127.0.0.1:${port}${p}` };
}

const PAYLOAD = Buffer.from('conteudo-fixo-do-teste-de-fila-streamgrab-0123456789');

/** Servidor com atraso opcional e contador de requisicoes em voo. */
function serveFile({ delay = 0 } = {}) {
  let inflight = 0;
  let maxInflight = 0;
  const handler = (req, res) => {
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    const respond = () => {
      try {
        inflight -= 1;
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': PAYLOAD.length });
        res.end(PAYLOAD);
      } catch {
        inflight -= 1; // cliente abortou
      }
    };
    if (delay > 0) setTimeout(respond, delay);
    else respond();
  };
  return { handler, stats: () => ({ inflight, maxInflight }) };
}

/** Espera o job atingir um dos estados aceitos (pooling com timeout). */
async function waitForState(queue, id, states, timeoutMs = 8000) {
  const accepted = new Set(Array.isArray(states) ? states : [states]);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = queue.get(id);
    if (job && accepted.has(job.state)) return job;
    if (Date.now() > deadline) {
      const job = queue.get(id);
      throw new Error(`timeout esperando [${[...accepted]}]; estado atual: ${job?.state || '?'}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('services: userDataDir e obrigatorio', () => {
  assert.throws(() => createElectronServices(), TypeError);
  assert.throws(() => createElectronServices({}), TypeError);
  assert.throws(() => createElectronServices({ userDataDir: '' }), TypeError);
});

test('services: fila baixa com limite de concorrencia (electron→core→queue→download)', async () => {
  const tmp = makeTempDir();
  const { handler, stats } = serveFile({ delay: 120 });
  const { url, stop } = await startServer(handler);
  try {
    const services = createElectronServices({ userDataDir: tmp });
    services.applySettings({ maxConcurrentDownloads: 2 });
    const ids = [];
    for (let i = 1; i <= 4; i += 1) {
      const job = services.queue.enqueue(url(`/v${i}.mp4`), {
        title: `video ${i}`,
        meta: { destination: tmp, filename: `v${i}.mp4`, sourceUrl: url(`/v${i}.mp4`) },
      });
      ids.push(job.id);
    }
    for (const id of ids) {
      await waitForState(services.queue, id, ['completed', 'failed']);
    }
    assert.ok(stats().maxInflight <= 2, `limite de concorrencia violado: ${stats().maxInflight} em voo`);
    assert.ok(stats().maxInflight >= 1, 'deve haver concorrencia');
    for (const id of ids) {
      const job = services.queue.get(id);
      assert.equal(job.state, 'completed');
      assert.ok(job.meta.output && fs.existsSync(job.meta.output), `saida deve existir: ${job.meta.output}`);
      assert.equal(fs.readFileSync(job.meta.output).toString(), PAYLOAD.toString());
    }
    services.dispose();
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('services: meta.filename define o nome de saida (sem prompts do CLI)', async () => {
  const tmp = makeTempDir();
  const { handler } = serveFile();
  const { url, stop } = await startServer(handler);
  try {
    const services = createElectronServices({ userDataDir: tmp });
    const job = services.queue.enqueue(url('/origem.mp4'), {
      title: 'titulo da analise',
      meta: { destination: tmp, filename: 'nome-personalizado.mp4' },
    });
    await waitForState(services.queue, job.id, ['completed', 'failed']);
    const out = services.queue.getOutputPath(job.id);
    assert.equal(path.basename(out), 'nome-personalizado.mp4');
    assert.ok(fs.existsSync(out));
    services.dispose();
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('services: cancelar um download ativo', async () => {
  const tmp = makeTempDir();
  const { handler } = serveFile({ delay: 2000 });
  const { url, stop } = await startServer(handler);
  const events = [];
  try {
    const services = createElectronServices({ userDataDir: tmp, onEvent: (e) => events.push(e) });
    const job = services.queue.enqueue(url('/lento.mp4'), {
      meta: { destination: tmp, filename: 'lento.mp4' },
    });
    await waitForState(services.queue, job.id, 'downloading');
    services.queue.cancel(job.id);
    await waitForState(services.queue, job.id, 'cancelled');
    assert.ok(events.includes('cancel'), 'evento cancel deve ser emitido');
    services.dispose();
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('services: pausar e retomar um download', async () => {
  const tmp = makeTempDir();
  const { handler } = serveFile({ delay: 1500 });
  const { url, stop } = await startServer(handler);
  try {
    const services = createElectronServices({ userDataDir: tmp });
    const job = services.queue.enqueue(url('/pausa.mp4'), {
      meta: { destination: tmp, filename: 'pausa.mp4' },
    });
    await waitForState(services.queue, job.id, 'downloading');
    services.queue.pause(job.id);
    await waitForState(services.queue, job.id, 'paused');
    services.queue.resume(job.id);
    await waitForState(services.queue, job.id, ['completed', 'failed']);
    assert.equal(services.queue.get(job.id).state, 'completed');
    services.dispose();
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('services: retry re-enfileira job falho e completa na 2a tentativa', async () => {
  const tmp = makeTempDir();
  const hits = new Map();
  const { url, stop } = await startServer((req, res) => {
    const n = (hits.get(req.url) || 0) + 1;
    hits.set(req.url, n);
    if (n === 1) {
      res.writeHead(404, { 'Content-Length': 9 });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': PAYLOAD.length });
    res.end(PAYLOAD);
  });
  try {
    const services = createElectronServices({ userDataDir: tmp });
    const job = services.queue.enqueue(url('/falha.mp4'), {
      meta: { destination: tmp, filename: 'falha.mp4' },
    });
    await waitForState(services.queue, job.id, ['failed', 'completed']);
    assert.equal(services.queue.get(job.id).state, 'failed');

    const retried = services.queue.retry(job.id);
    assert.notEqual(retried.id, job.id);
    assert.equal(retried.meta.retryOf, job.id);
    await waitForState(services.queue, retried.id, ['failed', 'completed']);
    assert.equal(services.queue.get(retried.id).state, 'completed');
    assert.ok(fs.existsSync(services.queue.getOutputPath(retried.id)));
    services.dispose();
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('services: historico registra e persiste entre reinicios', async () => {
  const tmp = makeTempDir();
  const { handler } = serveFile();
  const { url, stop } = await startServer(handler);
  try {
    const services = createElectronServices({ userDataDir: tmp });
    const job = services.queue.enqueue(url('/hist.mp4'), {
      title: 'historico',
      meta: { destination: tmp, filename: 'hist.mp4' },
    });
    await waitForState(services.queue, job.id, 'completed');
    const entries = services.history.list();
    assert.ok(entries.length >= 1, 'historico deve ter entradas');
    const entry = entries.find((e) => e.url === url('/hist.mp4'));
    assert.ok(entry, 'entrada do historico deve existir');
    assert.equal(entry.status, 'completed');
    assert.equal(entry.destination, services.queue.getOutputPath(job.id));
    services.dispose();

    // Reinicio: historico carregado do disco (item 5).
    const services2 = createElectronServices({ userDataDir: tmp });
    assert.ok(
      services2.history.list().some((e) => e.url === url('/hist.mp4')),
      'historico deve persistir apos reiniciar'
    );
    services2.dispose();
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('services: crash recovery — jobs em andamento voltam como queued', async () => {
  const tmp = makeTempDir();
  const { handler } = serveFile({ delay: 1500 });
  const { url, stop } = await startServer(handler);
  try {
    const services = createElectronServices({ userDataDir: tmp });
    const job = services.queue.enqueue(url('/crash.mp4'), {
      meta: { destination: tmp, filename: 'crash.mp4' },
    });
    await waitForState(services.queue, job.id, 'downloading'); // 'started' → snapshot salvo
    services.dispose(); // simula crash: sem save() explicito

    // Reinicio: o job restaurado do queue.json (recovered=true) volta `queued`.
    const services2 = createElectronServices({ userDataDir: tmp });
    const restored = services2.queue.all().find((j) => j.meta?.recovered === true);
    assert.ok(restored, 'job deve ser restaurado do disco');
    assert.equal(restored.url, url('/crash.mp4'));
    assert.equal(restored.meta.filename, 'crash.mp4');
    services2.dispose();
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('services: applySettings ajusta maxConcurrentDownloads e persiste', async () => {
  const tmp = makeTempDir();
  try {
    const services = createElectronServices({ userDataDir: tmp });
    assert.equal(services.queue.maxConcurrent, 3);
    const updated = services.applySettings({ maxConcurrentDownloads: 7 });
    assert.equal(updated.maxConcurrentDownloads, 7);
    assert.equal(services.queue.maxConcurrent, 7);
    assert.equal(services.settings.get('maxConcurrentDownloads'), 7);
    assert.ok(fs.existsSync(path.join(tmp, 'settings.json')), 'settings.json deve existir');
    services.dispose();

    const services2 = createElectronServices({ userDataDir: tmp });
    assert.equal(services2.settings.get('maxConcurrentDownloads'), 7);
    assert.equal(services2.queue.maxConcurrent, 7);
    services2.dispose();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
