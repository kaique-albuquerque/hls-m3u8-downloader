import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DownloadEngine,
  createDownloadEngine,
  createDefaultExecutor,
  defaultResolveAdapter,
} from '../../src/core/engine.js';
import { NetworkError, UnsupportedSourceError } from '../../src/core/errors.js';
import { EVENT_NAMES } from '../../src/core/events.js';

// ---------------------------------------------------------------------------
// Mocks: executor deterministico + resolver fake (sem rede externa).
// ---------------------------------------------------------------------------

const FAKE_ADAPTER = { id: 'direct' };

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

/** Resolver fake: nunca faz rede. */
function fakeResolver({ adapter = FAKE_ADAPTER, spy } = {}) {
  return async (url, opts) => {
    spy?.(url, opts);
    return adapter;
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-engine-test-'));
}

async function waitFor(fn, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando condicao');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function makeEngine(opts = {}) {
  return new DownloadEngine({
    progressThrottleMs: 0,
    resolveAdapter: fakeResolver(),
    executor: createFakeExecutor(),
    ...opts,
  });
}

// ---------------------------------------------------------------------------

test('core-engine: factory, classe e executor padrao expostos', () => {
  assert.equal(typeof DownloadEngine, 'function');
  assert.equal(typeof createDownloadEngine, 'function');
  assert.ok(createDownloadEngine({ resolveAdapter: fakeResolver() }) instanceof DownloadEngine);
  assert.equal(typeof createDefaultExecutor, 'function');
  assert.equal(typeof defaultResolveAdapter, 'function');
  const executor = createDefaultExecutor();
  assert.equal(typeof executor.analyze, 'function');
  assert.equal(typeof executor.prepare, 'function');
  assert.equal(typeof executor.run, 'function');
});

test('core-engine: ciclo completo enqueue -> run emite eventos e termina completed', async () => {
  const tmp = makeTempDir();
  const engine = makeEngine();
  const seen = [];
  for (const name of EVENT_NAMES) engine.on(name, (payload) => seen.push({ name, payload }));

  const queued = engine.enqueue('https://example.com/video.mp4', { title: 'Meu video' });
  const job = await engine.run(queued.id, { destination: tmp });

  assert.equal(job.state, 'completed');
  assert.equal(job.title, 'Titulo de direct');
  assert.ok(job.meta.output, 'output deve ser preenchido');
  assert.ok(fs.existsSync(job.meta.output), 'arquivo final deve existir');

  const names = seen.map((e) => e.name);
  for (const expected of ['start', 'progress', 'complete']) {
    assert.ok(names.includes(expected), `evento ${expected} deve ter sido emitido`);
  }
  assert.ok(!names.includes('error'));

  const states = job.history.map((h) => h.to);
  assert.deepEqual(states, ['queued', 'analyzing', 'preparing', 'downloading', 'completed']);
  assert.deepEqual(engine.getQueue(), []);
  assert.deepEqual(engine.getHistory().map((j) => j.id), [job.id]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: run com URL nova cria job e o titulo analisado prevalece', async () => {
  const tmp = makeTempDir();
  const engine = makeEngine();
  const job = await engine.run('https://example.com/video.mp4', { destination: tmp });
  assert.equal(job.state, 'completed');
  assert.ok(job.id.startsWith('job-'));
  assert.equal(job.title, 'Titulo de direct');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: cancelamento interrompe, limpa parcial e emite cancel', async () => {
  const tmp = makeTempDir();
  const executor = createFakeExecutor({
    async run({ signal, output }) {
      await fs.promises.writeFile(output, 'parcial');
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener('abort', resolve, { once: true });
      });
      return { cancelled: true };
    },
  });
  const engine = makeEngine({ executor });
  const cancelled = [];
  engine.on('cancel', (p) => cancelled.push(p));

  const promise = engine.run('https://example.com/video.mp4', { destination: tmp });
  await waitFor(() => engine.getQueue().some((j) => j.state === 'downloading'));
  engine.cancel(engine.getQueue()[0].id);

  const job = await promise;
  assert.equal(job.state, 'cancelled');
  assert.equal(job.error.code, 'CANCELLED');
  assert.ok(!fs.existsSync(job.meta.output), 'parcial deve ser removido');
  assert.equal(cancelled.length, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: erro HTTP 500 e mapeado para NetworkError retryable (P2.2)', async () => {
  const tmp = makeTempDir();
  const executor = createFakeExecutor({
    async run() {
      return { ok: false, code: 'HTTP_ERROR', error: 'HTTP 500', status: 500 };
    },
  });
  const engine = makeEngine({ executor });
  const errors = [];
  engine.on('error', (p) => errors.push(p));

  await assert.rejects(
    () => engine.run('https://example.com/video.mp4', { destination: tmp }),
    (err) => err instanceof NetworkError && err.retryable === true
  );

  const job = engine.getHistory()[0];
  assert.equal(job.state, 'failed');
  assert.equal(job.error.code, 'NETWORK_ERROR');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].stage, 'failed');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: erro lancado no analyze do executor e classificado e job falha', async () => {
  const tmp = makeTempDir();
  const executor = createFakeExecutor({
    async analyze() {
      const err = new Error('HTTP 401');
      err.status = 401;
      throw err;
    },
  });
  const engine = makeEngine({ executor });
  await assert.rejects(() => engine.run('https://example.com/video.mp4', { destination: tmp }));
  const job = engine.getHistory()[0];
  assert.equal(job.state, 'failed');
  assert.equal(job.error.code, 'AUTHENTICATION_ERROR');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: fonte desconhecida vira UnsupportedSourceError e job falha', async () => {
  const tmp = makeTempDir();
  const engine = makeEngine({ resolveAdapter: fakeResolver({ adapter: { id: 'unknown' } }) });
  await assert.rejects(
    () => engine.run('https://example.com/arquivo.xyz', { destination: tmp }),
    (err) => err instanceof UnsupportedSourceError
  );
  const job = engine.getHistory()[0];
  assert.equal(job.state, 'failed');
  assert.equal(job.error.code, 'UNSUPPORTED_SOURCE');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: estado consistente em cada transicao (historico valido)', async () => {
  const tmp = makeTempDir();
  const engine = makeEngine();
  const job = await engine.run('https://example.com/video.mp4', { destination: tmp });
  const chain = job.history.map((h) => h.to);
  assert.deepEqual(chain, ['queued', 'analyzing', 'preparing', 'downloading', 'completed']);
  // Serializacao limpa: sem campos circulares nem funcoes.
  const json = JSON.parse(JSON.stringify(job));
  assert.equal(json.state, 'completed');
  assert.equal(json.error, null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: pause/resume reexecuta o download e emite pause/resume', async () => {
  const tmp = makeTempDir();
  let attempts = 0;
  const executor = createFakeExecutor({
    async run({ signal, onProgress, output }) {
      attempts += 1;
      onProgress({ bytesDownloaded: 50, totalBytes: 1000, percent: 5 });
      if (attempts === 1) {
        await new Promise((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener('abort', resolve, { once: true });
        });
        return { paused: true };
      }
      await fs.promises.writeFile(output, 'final');
      return { ok: true };
    },
  });
  const engine = makeEngine({ executor });
  const pauses = [];
  const resumes = [];
  engine.on('pause', (p) => pauses.push(p));
  engine.on('resume', (p) => resumes.push(p));

  const promise = engine.run('https://example.com/video.mp4', { destination: tmp });
  await waitFor(() => engine.getQueue().some((j) => j.state === 'downloading'));
  engine.pause(engine.getQueue()[0].id);
  await waitFor(() => engine.getQueue().some((j) => j.state === 'paused'));
  engine.resume(engine.getQueue()[0].id);

  const job = await promise;
  assert.equal(job.state, 'completed');
  assert.equal(attempts, 2);
  assert.equal(pauses.length, 1);
  assert.equal(resumes.length, 1);
  assert.ok(job.history.some((h) => h.to === 'paused'), 'historico deve conter paused');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: cancel de job queued finaliza direto e run posterior lanca JOB_ALREADY_FINAL', async () => {
  const engine = makeEngine();
  const queued = engine.enqueue('https://example.com/video.mp4');
  const cancelled = [];
  engine.on('cancel', (p) => cancelled.push(p));
  const result = engine.cancel(queued.id);
  assert.equal(result.state, 'cancelled');
  assert.equal(cancelled.length, 1);
  await assert.rejects(
    () => engine.run(queued.id),
    (err) => err.code === 'JOB_ALREADY_FINAL'
  );
});

test('core-engine: cancel de job pausado acorda o loop e finaliza', async () => {
  const tmp = makeTempDir();
  let attempts = 0;
  const executor = createFakeExecutor({
    async run({ signal }) {
      attempts += 1;
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener('abort', resolve, { once: true });
      });
      return attempts === 1 ? { paused: true } : { cancelled: true };
    },
  });
  const engine = makeEngine({ executor });
  const promise = engine.run('https://example.com/video.mp4', { destination: tmp });
  await waitFor(() => engine.getQueue().some((j) => j.state === 'downloading'));
  engine.pause(engine.getQueue()[0].id);
  await waitFor(() => engine.getQueue().some((j) => j.state === 'paused'));
  engine.cancel(engine.getQueue()[0].id);
  const job = await promise;
  assert.equal(job.state, 'cancelled');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: run em job em andamento lanca JOB_ALREADY_RUNNING e controles JOB_NOT_FOUND', async () => {
  const tmp = makeTempDir();
  const executor = createFakeExecutor({
    async run({ signal }) {
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener('abort', resolve, { once: true });
      });
      return { cancelled: true };
    },
  });
  const engine = makeEngine({ executor });
  const promise = engine.run('https://example.com/video.mp4', { destination: tmp });
  await waitFor(() => engine.getQueue().some((j) => j.state === 'downloading'));
  const queued = engine.getQueue()[0];
  await assert.rejects(
    () => engine.run(queued.id),
    (err) => err.code === 'JOB_ALREADY_RUNNING'
  );
  for (const fn of ['pause', 'resume', 'cancel']) {
    assert.throws(() => engine[fn]('inexistente'), (err) => err.code === 'JOB_NOT_FOUND');
  }
  engine.cancel(queued.id);
  await promise;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: download por id repassa selectedUrl ao prepare', async () => {
  const tmp = makeTempDir();
  const preparedUrls = [];
  const executor = createFakeExecutor({
    async prepare(adapter, { selectedUrl }) {
      preparedUrls.push(selectedUrl);
      return { strategy: 'single', downloadUrl: selectedUrl, totalBytes: 100, durationMs: 1000 };
    },
  });
  const engine = makeEngine({ executor });
  const queued = engine.enqueue('https://example.com/video.mp4', { title: 'Playlist' });
  const job = await engine.run(queued.id, { selectedUrl: 'ytdlp-format:137', destination: tmp });
  assert.equal(job.id, queued.id);
  assert.equal(job.state, 'completed');
  assert.deepEqual(preparedUrls, ['ytdlp-format:137']);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: resolveAdapter injetado e usado (spy)', async () => {
  const tmp = makeTempDir();
  const calls = [];
  const engine = makeEngine({ resolveAdapter: fakeResolver({ spy: (url, opts) => calls.push({ url, opts }) }) });
  await engine.run('https://example.com/video.mp4', { destination: tmp });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/video.mp4');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: progress emite speed e eta separados', async () => {
  const tmp = makeTempDir();
  const engine = makeEngine();
  const speeds = [];
  const etas = [];
  engine.on('speed', (p) => speeds.push(p));
  engine.on('eta', (p) => etas.push(p));
  await engine.run('https://example.com/video.mp4', { destination: tmp });
  assert.equal(speeds.length, 1);
  assert.equal(speeds[0].speed, 1024);
  assert.equal(etas.length, 1);
  assert.equal(etas[0].etaSeconds, 9);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: dispose cancela downloads ativos', async () => {
  const tmp = makeTempDir();
  const executor = createFakeExecutor({
    async run({ signal, output }) {
      await fs.promises.writeFile(output, 'parcial');
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener('abort', resolve, { once: true });
      });
      return { cancelled: true };
    },
  });
  const engine = makeEngine({ executor });
  const promise = engine.run('https://example.com/video.mp4', { destination: tmp });
  await waitFor(() => engine.getQueue().some((j) => j.state === 'downloading'));
  engine.dispose();
  const job = await promise;
  assert.equal(job.state, 'cancelled');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('core-engine: erro em handler de evento nao derruba o engine', async () => {
  const tmp = makeTempDir();
  const engine = makeEngine();
  engine.on('progress', () => {
    throw new Error('boom no handler');
  });
  const job = await engine.run('https://example.com/video.mp4', { destination: tmp });
  assert.equal(job.state, 'completed');
  fs.rmSync(tmp, { recursive: true, force: true });
});
