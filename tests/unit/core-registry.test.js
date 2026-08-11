import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createStreamGrabCore, StreamGrabCore, createDefaultExecutor } from '../../src/core/registry.js';
import { NetworkError } from '../../src/core/errors.js';
import { EVENT_NAMES } from '../../src/core/events.js';

// ---------------------------------------------------------------------------
// Fake executor: mesmo contrato do executor padrao, deterministico.
// ---------------------------------------------------------------------------

function createFakeExecutor(overrides = {}) {
  let runCalls = 0;
  return {
    runCalls: () => runCalls,
    async analyze(adapter, { url }) {
      return {
        title: `Titulo de ${adapter.id}`,
        durationSeconds: 120,
        pageUrl: url,
        videoId: 'abc123',
        progressiveFormats: [{ formatId: '18', url: 'https://cdn.example/prog.mp4', height: 360 }],
        adaptiveVideoFormats: [{ formatId: '137', url: 'https://cdn.example/v.mp4', height: 1080 }],
        adaptiveAudioFormats: [{ formatId: '140', url: 'https://cdn.example/a.m4a' }],
        variants: ['https://cdn.example/prog.mp4', 'ytdlp-format:137'],
      };
    },
    async prepare(adapter, { selectedUrl }) {
      return {
        strategy: 'single',
        downloadUrl: selectedUrl || 'https://cdn.example/prog.mp4',
        chosenFormat: { sourceKind: 'progressive', formatId: '18' },
        totalBytes: 1000,
        durationMs: 120000,
      };
    },
    async run({ signal, onProgress, output }) {
      runCalls += 1;
      onProgress({ bytesDownloaded: 100, totalBytes: 1000, percent: 10, speed: 1024, etaSeconds: 9 });
      await fs.promises.writeFile(output, 'conteudo-do-arquivo');
      if (signal?.aborted) {
        return signal.reason === 'pause' ? { paused: true } : { cancelled: true };
      }
      return { ok: true };
    },
    ...overrides,
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-core-test-'));
}

/** Servidor local simples (sem rede externa) para testes de deteccao. */
async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const stop = () => new Promise((resolve) => server.close(resolve));
  return { port, stop, url: (p) => `http://127.0.0.1:${port}${p}` };
}

async function waitFor(fn, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando condicao');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ---------------------------------------------------------------------------

test('core-registry: factory e classe expostas', () => {
  assert.equal(typeof createStreamGrabCore, 'function');
  assert.equal(typeof StreamGrabCore, 'function');
  assert.ok(createStreamGrabCore() instanceof StreamGrabCore);
  assert.equal(typeof createDefaultExecutor, 'function');
  const executor = createDefaultExecutor();
  assert.equal(typeof executor.analyze, 'function');
  assert.equal(typeof executor.prepare, 'function');
  assert.equal(typeof executor.run, 'function');
});

test('core-registry: analyze delega ao adapter e normaliza MediaInfo', async () => {
  const core = createStreamGrabCore({ executor: createFakeExecutor() });
  const { adapter, info } = await core.analyze('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(adapter.id, 'youtube');
  assert.equal(info.sourceType, 'youtube');
  assert.equal(info.title, 'Titulo de youtube');
  assert.ok(Array.isArray(info.formats));
  assert.ok(Array.isArray(info.variants));
  assert.equal(info.durationSeconds, 120);
});

test('core-registry: analyze com URL desconhecida lanca UnsupportedSource', async () => {
  const { url, stop } = await startServer((req, res) => {
    res.writeHead(404);
    res.end('not found');
  });
  try {
    const core = createStreamGrabCore({ executor: createFakeExecutor() });
    await assert.rejects(
      () => core.analyze(url('/arquivo.xyz')),
      (err) => err.code === 'UNSUPPORTED_SOURCE'
    );
  } finally {
    await stop();
  }
});

test('core-registry: enqueue cria job queued e getQueue/getHistory separam', async () => {
  const core = createStreamGrabCore({ executor: createFakeExecutor() });
  const job = core.enqueue('https://example.com/video.mp4', { title: 'Meu video' });
  assert.equal(job.state, 'queued');
  assert.equal(job.title, 'Meu video');
  assert.ok(job.id.startsWith('job-'));
  assert.deepEqual(core.getQueue().map((j) => j.id), [job.id]);
  assert.deepEqual(core.getHistory(), []);
  assert.deepEqual(core.getJob(job.id), job);
  assert.equal(core.getJob('inexistente'), null);
});

test('core-registry: download de URL completa o ciclo e emite eventos', async () => {
  const tmp = makeTempDir();
  const core = createStreamGrabCore({ executor: createFakeExecutor(), progressThrottleMs: 0 });
  const seen = [];
  for (const name of EVENT_NAMES) {
    core.on(name, (payload) => seen.push({ name, payload }));
  }
  const job = await core.download('https://example.com/video.mp4', { destination: tmp });

  assert.equal(job.state, 'completed');
  assert.equal(job.title, 'Titulo de direct');
  assert.ok(job.meta.output, 'output deve ser preenchido');
  assert.ok(fs.existsSync(job.meta.output), 'arquivo final deve existir');

  const names = seen.map((e) => e.name);
  for (const expected of ['start', 'progress', 'complete']) {
    assert.ok(names.includes(expected), `evento ${expected} deve ter sido emitido`);
  }
  assert.ok(!names.includes('error'));
  const complete = seen.find((e) => e.name === 'complete').payload;
  assert.equal(complete.stage, 'completed');
  assert.equal(complete.jobId, job.id);
  const progress = seen.filter((e) => e.name === 'progress').find((e) => e.payload.stage === 'downloading');
  assert.ok(progress, 'deve haver progress com stage downloading');
  assert.equal(progress.payload.jobId, job.id);

  assert.deepEqual(core.getQueue(), []);
  assert.deepEqual(core.getHistory().map((j) => j.id), [job.id]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-registry: progresso emite eventos speed e eta separados', async () => {
  const tmp = makeTempDir();
  const core = createStreamGrabCore({ executor: createFakeExecutor(), progressThrottleMs: 0 });
  const speeds = [];
  const etas = [];
  core.on('speed', (p) => speeds.push(p));
  core.on('eta', (p) => etas.push(p));
  await core.download('https://example.com/video.mp4', { destination: tmp });
  assert.equal(speeds.length, 1);
  assert.equal(speeds[0].speed, 1024);
  assert.equal(speeds[0].jobId.startsWith('job-'), true);
  assert.equal(etas.length, 1);
  assert.equal(etas[0].etaSeconds, 9);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-registry: falha classifica erro e marca job como failed', async () => {
  const tmp = makeTempDir();
  const executor = createFakeExecutor({
    async run() {
      return { ok: false, code: 'HTTP_ERROR', error: 'HTTP 500', status: 500 };
    },
  });
  const core = createStreamGrabCore({ executor, progressThrottleMs: 0 });
  const errors = [];
  core.on('error', (p) => errors.push(p));

  await assert.rejects(
    () => core.download('https://example.com/video.mp4', { destination: tmp }),
    (err) => err instanceof NetworkError && err.retryable === true
  );

  const job = core.getHistory()[0];
  assert.equal(job.state, 'failed');
  assert.equal(job.error.code, 'NETWORK_ERROR');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].stage, 'failed');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-registry: cancel durante download interrompe, limpa parcial e emite cancel', async () => {
  const tmp = makeTempDir();
  const executor = createFakeExecutor({
    async run({ signal, output }) {
      await fs.promises.writeFile(output, 'parcial');
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return { cancelled: true };
    },
  });
  const core = createStreamGrabCore({ executor });
  const cancelled = [];
  core.on('cancel', (p) => cancelled.push(p));

  const promise = core.download('https://example.com/video.mp4', { destination: tmp });
  await waitFor(() => core.getQueue().some((j) => j.state === 'downloading'));
  const queued = core.getQueue()[0];
  core.cancel(queued.id);

  const job = await promise;
  assert.equal(job.state, 'cancelled');
  assert.equal(job.error.code, 'CANCELLED');
  assert.ok(!fs.existsSync(job.meta.output), 'parcial deve ser removido');
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].jobId, job.id);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-registry: pause/resume retoma o mesmo job e reexecuta o download', async () => {
  const tmp = makeTempDir();
  let attempts = 0;
  const executor = createFakeExecutor({
    async run({ signal, onProgress, output }) {
      attempts += 1;
      onProgress({ bytesDownloaded: 50, totalBytes: 1000, percent: 5 });
      if (attempts === 1) {
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        return { paused: true };
      }
      await fs.promises.writeFile(output, 'final');
      return { ok: true };
    },
  });
  const core = createStreamGrabCore({ executor, progressThrottleMs: 0 });
  const pauses = [];
  const resumes = [];
  core.on('pause', (p) => pauses.push(p));
  core.on('resume', (p) => resumes.push(p));

  const promise = core.download('https://example.com/video.mp4', { destination: tmp });
  await waitFor(() => core.getQueue().some((j) => j.state === 'downloading'));
  const downloading = core.getQueue()[0];
  core.pause(downloading.id);
  await waitFor(() => core.getQueue().some((j) => j.state === 'paused'));
  core.resume(downloading.id);

  const job = await promise;
  assert.equal(job.state, 'completed');
  assert.equal(attempts, 2);
  assert.equal(pauses.length, 1);
  assert.equal(resumes.length, 1);
  const states = job.history.map((h) => h.to);
  assert.ok(states.includes('paused'), 'historico deve conter paused');
  assert.ok(fs.existsSync(job.meta.output));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-registry: cancel de job pausado acorda o loop e finaliza', async () => {
  const tmp = makeTempDir();
  let attempts = 0;
  const executor = createFakeExecutor({
    async run({ signal }) {
      attempts += 1;
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return attempts === 1 ? { paused: true } : { cancelled: true };
    },
  });
  const core = createStreamGrabCore({ executor });
  const promise = core.download('https://example.com/video.mp4', { destination: tmp });
  await waitFor(() => core.getQueue().some((j) => j.state === 'downloading'));
  core.pause(core.getQueue()[0].id);
  await waitFor(() => core.getQueue().some((j) => j.state === 'paused'));
  core.cancel(core.getQueue()[0].id);
  const job = await promise;
  assert.equal(job.state, 'cancelled');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-registry: cancel de job queued (sem iniciar) finaliza direto', async () => {
  const core = createStreamGrabCore({ executor: createFakeExecutor() });
  const job = core.enqueue('https://example.com/video.mp4');
  const cancelled = [];
  core.on('cancel', (p) => cancelled.push(p));
  const result = core.cancel(job.id);
  assert.equal(result.state, 'cancelled');
  assert.equal(core.getJob(job.id).state, 'cancelled');
  assert.equal(cancelled.length, 1);
});

test('core-registry: download por id usa o job enfileirado e selectedUrl chega ao prepare', async () => {
  const tmp = makeTempDir();
  const preparedUrls = [];
  const executor = createFakeExecutor({
    async prepare(adapter, { selectedUrl }) {
      preparedUrls.push(selectedUrl);
      return { strategy: 'single', downloadUrl: selectedUrl, totalBytes: 100, durationMs: 1000 };
    },
  });
  const core = createStreamGrabCore({ executor });
  const queued = core.enqueue('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { title: 'Playlist' });
  const job = await core.download(queued.id, { selectedUrl: 'ytdlp-format:137', destination: tmp });
  assert.equal(job.id, queued.id);
  // O titulo analisado (real do video) prevalece para o nome do arquivo.
  assert.equal(job.title, 'Titulo de youtube');
  assert.equal(job.state, 'completed');
  assert.deepEqual(preparedUrls, ['ytdlp-format:137']);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-registry: download em job finalizado/em andamento lanca erro claro', async () => {
  const tmp = makeTempDir();
  const core = createStreamGrabCore({ executor: createFakeExecutor() });
  const done = await core.download('https://example.com/video.mp4', { destination: tmp });
  await assert.rejects(
    () => core.download(done.id, { destination: tmp }),
    (err) => err.code === 'JOB_ALREADY_FINAL'
  );

  const executor = createFakeExecutor({
    async run({ signal }) {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return { cancelled: true };
    },
  });
  const core2 = createStreamGrabCore({ executor });
  const promise = core2.download('https://example.com/video2.mp4', { destination: tmp });
  await waitFor(() => core2.getQueue().some((j) => j.state === 'downloading'));
  const running = core2.getQueue()[0];
  await assert.rejects(
    () => core2.download(running.id, { destination: tmp }),
    (err) => err.code === 'JOB_ALREADY_RUNNING'
  );
  core2.cancel(running.id);
  await promise;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-registry: pause/resume/cancel em estados invalidos sao idempotentes', async () => {
  const core = createStreamGrabCore({ executor: createFakeExecutor() });
  const job = core.enqueue('https://example.com/video.mp4');
  const paused = core.pause(job.id);
  assert.equal(paused.state, 'queued', 'pause em queued nao muda estado');
  const resumed = core.resume(job.id);
  assert.equal(resumed.state, 'queued', 'resume sem pause nao muda estado');
  assert.throws(() => core.pause('nao-existe'), (err) => err.code === 'JOB_NOT_FOUND');
  assert.throws(() => core.resume('nao-existe'), (err) => err.code === 'JOB_NOT_FOUND');
  assert.throws(() => core.cancel('nao-existe'), (err) => err.code === 'JOB_NOT_FOUND');
});

test('core-registry: dispose cancela downloads ativos', async () => {
  const tmp = makeTempDir();
  const executor = createFakeExecutor({
    async run({ signal }) {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return { cancelled: true };
    },
  });
  const core = createStreamGrabCore({ executor });
  const promise = core.download('https://example.com/video.mp4', { destination: tmp });
  await waitFor(() => core.getQueue().some((j) => j.state === 'downloading'));
  core.dispose();
  const job = await promise;
  assert.equal(job.state, 'cancelled');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-registry: erro em handler de evento nao derruba a fachada', async () => {
  const tmp = makeTempDir();
  const core = createStreamGrabCore({ executor: createFakeExecutor(), progressThrottleMs: 0 });
  core.on('progress', () => {
    throw new Error('boom no handler');
  });
  const job = await core.download('https://example.com/video.mp4', { destination: tmp });
  assert.equal(job.state, 'completed');
  fs.rmSync(tmp, { recursive: true, force: true });
});
