import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DownloadEngine } from '../../src/core/engine.js';
import { createSettingsStore } from '../../src/core/settings.js';
import { createHistoryStore } from '../../src/core/history.js';
import { createAtomicFile } from '../../src/core/atomic.js';

// ---------------------------------------------------------------------------
// Integracao P7: engine + settings(defaultDir) + disk + history + atomic
// (mesmo executor fake do core-engine.test.js)
// ---------------------------------------------------------------------------

const FAKE_ADAPTER = { id: 'direct' };

function createFakeExecutor(overrides = {}) {
  return {
    async analyze() {
      return {
        title: 'Titulo P7',
        durationSeconds: 60,
        pageUrl: 'https://cdn.example/v.mp4',
        progressiveFormats: [{ formatId: '18', url: 'https://cdn.example/prog.mp4', height: 360 }],
        adaptiveVideoFormats: [],
        adaptiveAudioFormats: [],
        variants: ['https://cdn.example/prog.mp4'],
      };
    },
    async prepare() {
      return {
        strategy: 'single',
        downloadUrl: 'https://cdn.example/prog.mp4',
        chosenFormat: { sourceKind: 'progressive', formatId: '18' },
        totalBytes: 1000,
        durationMs: 60000,
      };
    },
    async run({ signal, output }) {
      await fs.promises.writeFile(output, 'conteudo-p7');
      if (signal?.aborted) return { cancelled: true };
      return { ok: true };
    },
    ...overrides,
  };
}

function fakeResolver() {
  return async () => FAKE_ADAPTER;
}

async function waitFor(fn, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando condicao');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('engine usa settings.defaultDir, checa disco, registra historico e finaliza atomic', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-p7-'));
  const settingsFile = path.join(root, 'settings.json');
  const historyFile = path.join(root, 'history.json');
  const downloadDir = path.join(root, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });

  const settings = createSettingsStore({ file: settingsFile });
  settings.set('defaultDir', downloadDir);
  const history = createHistoryStore({ file: historyFile });

  const diskCalls = [];
  const disk = {
    async check(opts) {
      diskCalls.push(opts);
      return true;
    },
  };
  const atomic = { createAtomicFile };

  const engine = new DownloadEngine({
    progressThrottleMs: 0,
    resolveAdapter: fakeResolver(),
    executor: createFakeExecutor(),
    settings,
    disk,
    history,
    atomic,
  });

  const done = new Promise((resolve) => engine.on('complete', resolve));
  const enqueued = engine.enqueue('https://cdn.example/v.mp4', { title: 'Video P7' });
  engine.run(enqueued.id, {});
  const complete = await done;

  assert.equal(complete.jobId, enqueued.id);
  assert.equal(diskCalls.length, 1, 'checagem de disco executada uma vez');
  assert.equal(diskCalls[0].dir, downloadDir, 'usou defaultDir dos settings');
  assert.equal(diskCalls[0].requiredBytes, 1000);

  const job = engine.getJob(enqueued.id);
  assert.equal(job.state, 'completed');
  // analyze() sobrescreve o titulo com 'Titulo P7'
  assert.equal(job.meta.output, path.join(downloadDir, 'Titulo P7.mp4'));
  assert.equal(fs.existsSync(job.meta.output), true, 'arquivo final existe');
  assert.equal(fs.readFileSync(job.meta.output, 'utf8'), 'conteudo-p7');

  // atomic: nenhum .part sobrou
  const part = `${job.meta.output}.part`;
  assert.equal(fs.existsSync(part), false, 'sem .part apos o commit');

  // historico registrado e persistido
  assert.equal(history.count(), 1);
  const entry = history.list()[0];
  assert.equal(entry.status, 'completed');
  assert.equal(entry.title, 'Titulo P7');
  assert.equal(entry.url, 'https://cdn.example/v.mp4');
  assert.equal(entry.destination, job.meta.output);
  assert.equal(entry.size, 'conteudo-p7'.length);
});

test('cancel com atomic remove o .part (nenhum arquivo final)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-p7-cancel-'));
  const downloadDir = path.join(root, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });

  const settings = createSettingsStore({ file: path.join(root, 's.json') });
  settings.set('defaultDir', downloadDir);
  const history = createHistoryStore({ file: path.join(root, 'h.json') });

  // executor que bloqueia ate o abort (lida com abort anterior a anexacao)
  const executor = createFakeExecutor({
    async run({ signal, output }) {
      await fs.promises.writeFile(output, 'parcial');
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true });
        if (signal.aborted) resolve();
      });
      return { cancelled: true };
    },
  });

  const engine = new DownloadEngine({
    progressThrottleMs: 0,
    resolveAdapter: fakeResolver(),
    executor,
    settings,
    history,
    atomic: { createAtomicFile },
  });

  const cancelled = new Promise((resolve) => engine.on('cancel', resolve));
  const enqueued = engine.enqueue('https://cdn.example/v.mp4', { title: 'Cancelar' });
  engine.run(enqueued.id, {});
  await waitFor(() => engine.getJob(enqueued.id).state === 'downloading');
  engine.cancel(enqueued.id);
  await cancelled;

  const job = engine.getJob(enqueued.id);
  assert.equal(job.state, 'cancelled');
  assert.equal(fs.existsSync(job.meta.output), false, 'final nao existe');
  assert.equal(fs.existsSync(`${job.meta.output}.part`), false, '.part removido');
  assert.equal(history.list().some((e) => e.status === 'cancelled'), true, 'historico registra cancelado');
});

test('remove(id) de job terminal funciona; de job ativo lanca JOB_ACTIVE', async () => {
  // executor que fica em 'downloading' ate o cancel
  const executor = createFakeExecutor({
    async run({ signal }) {
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true });
        if (signal.aborted) resolve();
      });
      return { cancelled: true };
    },
  });
  const engine = new DownloadEngine({
    progressThrottleMs: 0,
    resolveAdapter: fakeResolver(),
    executor,
  });
  const enqueued = engine.enqueue('https://cdn.example/v.mp4');
  const running = engine.run(enqueued.id, {});
  await waitFor(() => engine.getJob(enqueued.id).state === 'downloading');
  assert.throws(() => engine.remove(enqueued.id), (err) => err.code === 'JOB_ACTIVE');
  engine.cancel(enqueued.id);
  await running;
  assert.equal(engine.remove(enqueued.id), true);
  assert.equal(engine.getJob(enqueued.id), null);
});

test('enqueue aceita id explicito (restauracao de fila)', () => {
  const engine = new DownloadEngine({
    progressThrottleMs: 0,
    resolveAdapter: fakeResolver(),
    executor: createFakeExecutor(),
  });
  const job = engine.enqueue('https://cdn.example/v.mp4', { id: 'restaurado-1', title: 'T' });
  assert.equal(job.id, 'restaurado-1');
  assert.equal(engine.getJob('restaurado-1').title, 'T');
});
