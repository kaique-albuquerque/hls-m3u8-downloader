import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDownloadQueue, createDefaultQueueStorage } from '../../src/core/queue.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-queue-test-'));
}

// ---------------------------------------------------------------------------
// FakeEngine: contrato minimo do DownloadEngine usado pela fila
// ---------------------------------------------------------------------------

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

class FakeEngine {
  constructor({ runImpl } = {}) {
    this._jobs = new Map();
    this._listeners = new Map();
    this._id = 0;
    this._runImpl = runImpl;
    this.activeRuns = 0;
    this.maxActiveRuns = 0;
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const arr = this._listeners.get(event);
    if (!arr) return;
    const i = arr.indexOf(handler);
    if (i !== -1) arr.splice(i, 1);
  }

  _emit(event, payload) {
    for (const h of this._listeners.get(event) || []) h(payload);
  }

  enqueue(url, { id, title = '', meta = {} } = {}) {
    const now = new Date().toISOString();
    const job = { id: id || `job-${++this._id}`, url, title, meta: { ...meta }, state: 'queued', error: null, createdAt: now, updatedAt: now };
    this._jobs.set(job.id, job);
    return this.getJob(job.id);
  }

  getJob(id) {
    const j = this._jobs.get(String(id));
    return j ? { ...j, meta: { ...j.meta } } : null;
  }

  getQueue() {
    return [...this._jobs.values()].filter((j) => !TERMINAL.has(j.state));
  }

  getHistory() {
    return [...this._jobs.values()].filter((j) => TERMINAL.has(j.state));
  }

  async run(id) {
    const job = this._jobs.get(String(id));
    if (!job) return null;
    job.state = 'downloading';
    this.activeRuns += 1;
    this.maxActiveRuns = Math.max(this.maxActiveRuns, this.activeRuns);
    let outcome = 'completed';
    try {
      outcome = this._runImpl ? await this._runImpl(job) : 'completed';
      job.state = outcome;
      return job;
    } finally {
      this.activeRuns -= 1;
      this._emit(outcome === 'completed' ? 'complete' : outcome, { jobId: job.id });
    }
  }

  pause(id) {
    const j = this._jobs.get(String(id));
    if (j && !TERMINAL.has(j.state)) j.state = 'paused';
  }

  resume(id) {
    const j = this._jobs.get(String(id));
    if (j && j.state === 'paused') j.state = 'queued';
  }

  cancel(id) {
    const j = this._jobs.get(String(id));
    if (j && !TERMINAL.has(j.state)) {
      j.state = 'cancelled';
      this._emit('cancel', { jobId: j.id });
    }
  }

  remove(id) {
    this._jobs.delete(String(id));
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando condicao');
    await delay(10);
  }
}

// ---------------------------------------------------------------------------
// Limite de simultaneos
// ---------------------------------------------------------------------------

test('maxConcurrent e respeitado (nunca mais que o limite em paralelo)', async () => {
  const engine = new FakeEngine({ runImpl: async () => { await delay(60); return 'completed'; } });
  const queue = createDownloadQueue({ engine, maxConcurrent: 2 });
  for (let i = 0; i < 6; i++) queue.enqueue(`https://cdn.example/v${i}.mp4`, { title: `V${i}` });
  await waitFor(() => engine.getHistory().length === 6);
  assert.ok(engine.maxActiveRuns <= 2, `pico de paralelismo foi ${engine.maxActiveRuns}`);
  assert.equal(engine.getHistory().filter((j) => j.state === 'completed').length, 6);
  assert.equal(queue.list().length, 0);
});

test('maxConcurrent valido com clamps (0 -> 1, enorme -> 16)', () => {
  const q1 = createDownloadQueue({ engine: new FakeEngine(), maxConcurrent: 0 });
  assert.equal(q1.maxConcurrent, 1);
  const q2 = createDownloadQueue({ engine: new FakeEngine(), maxConcurrent: 999 });
  assert.equal(q2.maxConcurrent, 16);
});

test('ordem de fila preservada na listagem', () => {
  const queue = createDownloadQueue({ engine: new FakeEngine(), autoStart: false });
  queue.enqueue('https://a', { title: 'A' });
  queue.enqueue('https://b', { title: 'B' });
  queue.enqueue('https://c', { title: 'C' });
  assert.deepEqual(queue.list().map((j) => j.title), ['A', 'B', 'C']);
});

// ---------------------------------------------------------------------------
// Reordenacao
// ---------------------------------------------------------------------------

test('reorder move jobs apenas com fila parada (pausada)', () => {
  const queue = createDownloadQueue({ engine: new FakeEngine(), autoStart: false });
  queue.enqueue('https://a', { title: 'A' });
  queue.enqueue('https://b', { title: 'B' });
  queue.enqueue('https://c', { title: 'C' });
  queue.reorder(0, 2); // A para o fim
  assert.deepEqual(queue.list().map((j) => j.title), ['B', 'C', 'A']);
  queue.reorder(2, 0); // A de volta ao inicio
  assert.deepEqual(queue.list().map((j) => j.title), ['A', 'B', 'C']);
});

test('reorder com indices invalidos lanca INVALID_INDEX', () => {
  const queue = createDownloadQueue({ engine: new FakeEngine(), autoStart: false });
  queue.enqueue('https://a');
  queue.enqueue('https://b');
  assert.throws(() => queue.reorder(0, 5), (err) => err.code === 'INVALID_INDEX');
  assert.throws(() => queue.reorder(-1, 1), (err) => err.code === 'INVALID_INDEX');
});

test('reorder com download em andamento lanca QUEUE_BUSY', async () => {
  const engine = new FakeEngine({ runImpl: async () => { await delay(200); return 'completed'; } });
  const queue = createDownloadQueue({ engine, maxConcurrent: 1 });
  queue.enqueue('https://a');
  await waitFor(() => engine.getQueue().some((j) => j.state === 'downloading'));
  assert.throws(() => queue.reorder(0, 1), (err) => err.code === 'QUEUE_BUSY');
  await waitFor(() => engine.getHistory().length === 1);
});

// ---------------------------------------------------------------------------
// Cancelar / pausar / retomar
// ---------------------------------------------------------------------------

test('cancel interrompe e move o job para cancelled', async () => {
  const engine = new FakeEngine({ runImpl: async (job) => {
    await delay(300);
    return engine.getJob(job.id)?.state === 'cancelled' ? 'cancelled' : 'completed';
  } });
  const queue = createDownloadQueue({ engine, maxConcurrent: 1 });
  queue.enqueue('https://a');
  await waitFor(() => engine.getQueue().some((j) => j.state === 'downloading'));
  queue.cancel('job-1');
  await waitFor(() => engine.getHistory().some((j) => j.state === 'cancelled'));
  assert.equal(queue.get('job-1').state, 'cancelled');
  assert.equal(queue.list().length, 0);
});

test('pause/resume refletem no estado do job', async () => {
  const engine = new FakeEngine({ runImpl: async (job) => { await delay(150); return engine.getJob(job.id)?.state === 'paused' ? 'paused' : 'completed'; } });
  const queue = createDownloadQueue({ engine, maxConcurrent: 1 });
  queue.enqueue('https://a');
  await waitFor(() => engine.getQueue().some((j) => j.state === 'downloading'));
  queue.pause('job-1');
  assert.equal(queue.get('job-1').state, 'paused');
  queue.resume('job-1');
  assert.equal(queue.get('job-1').state, 'queued');
  await waitFor(() => engine.getHistory().some((j) => j.state === 'completed'));
});

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

test('retry re-enfileira a mesma URL como job novo (retryOf)', () => {
  const engine = new FakeEngine({ runImpl: async () => 'failed' });
  const queue = createDownloadQueue({ engine, maxConcurrent: 1 });
  const primeiro = queue.enqueue('https://a', { title: 'Titulo A' });
  // aguarda o job falhar e sair da fila
  return waitFor(() => engine.getHistory().some((j) => j.id === primeiro.id))
    .then(() => {
      const novo = queue.retry(primeiro.id);
      assert.equal(novo.url, 'https://a');
      assert.equal(novo.title, 'Titulo A');
      assert.equal(novo.meta.retryOf, primeiro.id);
      assert.equal(novo.state, 'queued');
    });
});

test('retry de job inexistente lanca JOB_NOT_FOUND', () => {
  const queue = createDownloadQueue({ engine: new FakeEngine() });
  assert.throws(() => queue.retry('job-999'), (err) => err.code === 'JOB_NOT_FOUND');
});

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

test('remove limpa o job da fila e do historico', async () => {
  const engine = new FakeEngine({ runImpl: async () => 'failed' });
  const queue = createDownloadQueue({ engine, maxConcurrent: 1 });
  const job = queue.enqueue('https://a');
  await waitFor(() => engine.getHistory().some((j) => j.id === job.id));
  queue.remove(job.id);
  assert.equal(queue.get(job.id), null);
  assert.equal(engine.getHistory().some((j) => j.id === job.id), false);
});

test('remove de job inexistente lanca JOB_NOT_FOUND', () => {
  const queue = createDownloadQueue({ engine: new FakeEngine() });
  assert.throws(() => queue.remove('job-777'), (err) => err.code === 'JOB_NOT_FOUND');
});

// ---------------------------------------------------------------------------
// Persistencia / crash recovery
// ---------------------------------------------------------------------------

test('snapshot/restore preserva url, titulo, meta e revalida como queued', () => {
  const engine = new FakeEngine();
  const queue = createDownloadQueue({ engine, autoStart: false });
  queue.enqueue('https://a', { title: 'A', meta: { format: 'mp4' } });
  queue.enqueue('https://b', { title: 'B' });

  const snap = queue.snapshot();
  assert.equal(snap.length, 2);

  const engine2 = new FakeEngine();
  const queue2 = createDownloadQueue({ engine: engine2, autoStart: false });
  queue2.restore(snap);
  const list = queue2.list();
  assert.deepEqual(list.map((j) => j.title), ['A', 'B']);
  assert.equal(list[0].state, 'queued');
  assert.equal(list[0].meta.format, 'mp4');
  assert.equal(list[0].meta.recovered, true);
});

test('crash recovery via storage: fila persistida e restaurada em nova instancia', () => {
  const file = path.join(makeTempDir(), 'queue.json');
  const storage = createDefaultQueueStorage({ file });

  const engine1 = new FakeEngine();
  const q1 = createDownloadQueue({ engine: engine1, storage, autoStart: false });
  q1.enqueue('https://a', { title: 'A' });
  q1.enqueue('https://b', { title: 'B' });
  q1.save();
  assert.ok(fs.existsSync(file));

  // "crash": nova instancia + novo engine, restaura do disco
  const engine2 = new FakeEngine();
  const q2 = createDownloadQueue({ engine: engine2, storage: createDefaultQueueStorage({ file }), autoStart: false });
  return q2.load().then(() => {
    const list = q2.list();
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((j) => j.title), ['A', 'B']);
    assert.ok(list.every((j) => j.state === 'queued'));
  });
});
