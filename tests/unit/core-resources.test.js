// P4 — core/resources: semaforo + limites de recursos.
//
// Cobre (plano §16/§41):
//  - Semaphore: adquire/release, ordem FIFO da fila
//  - limites de recursos respeitados (downloads, conexoes, ffmpeg, temporarios)
//  - cancelamento de quem espera na fila (signal -> CANCELLED)
//  - signal ja abortado ao entrar na fila -> rejeita imediatamente
//  - stats do ResourceManager

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Semaphore, ResourceManager, createDefaultResourceManager } from '../../src/core/resources.js';

test('Semaphore: adquire/release respeita o limite', async () => {
  const sem = new Semaphore(2);
  assert.equal(sem.available, 2);
  assert.equal(sem.active, 0);

  const r1 = await sem.acquire();
  const r2 = await sem.acquire();
  assert.equal(sem.available, 0);
  assert.equal(sem.active, 2);

  r1();
  assert.equal(sem.available, 1);
  r2();
  assert.equal(sem.available, 2);
  assert.equal(sem.active, 0);
});

test('Semaphore: fila FIFO — quem pede primeiro ganha o proximo slot', async () => {
  const sem = new Semaphore(1);
  const r1 = await sem.acquire();

  const order = [];
  const p2 = sem.acquire().then((release) => {
    order.push('segundo');
    release();
  });
  const p3 = sem.acquire().then((release) => {
    order.push('terceiro');
    release();
  });

  await new Promise((r) => setTimeout(r, 10));
  order.push('primeiro');
  r1();

  await Promise.all([p2, p3]);
  assert.deepEqual(order, ['primeiro', 'segundo', 'terceiro']);
});

test('Semaphore: rejeita com CANCELLED quando o signal aborta na fila', async () => {
  const sem = new Semaphore(1);
  const r1 = await sem.acquire();
  const ac = new AbortController();

  const p = sem.acquire(ac.signal);
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, (err) => err.code === 'CANCELLED');

  r1(); // libera para nao vazar
});

test('Semaphore: signal ja abortado -> rejeita imediatamente', async () => {
  const sem = new Semaphore(1);
  const r1 = await sem.acquire();
  const ac = new AbortController();
  ac.abort();

  await assert.rejects(sem.acquire(ac.signal), (err) => err.code === 'CANCELLED');
  r1();
});

test('Semaphore: constructor rejeita max < 1', () => {
  assert.throws(() => new Semaphore(0), /max/);
  assert.throws(() => new Semaphore(-1), /max/);
});

test('ResourceManager: limites padroes respeitados', async () => {
  const rm = createDefaultResourceManager();
  assert.deepEqual(rm.stats, {
    downloads: { active: 0, available: 3, max: 3 },
    connections: { active: 0, available: 8, max: 8 },
    ffmpeg: { active: 0, available: 2, max: 2 },
    tempDirs: { active: 0, available: 8, max: 8 },
  });
});

test('ResourceManager: acquireDownload respeita o limite de downloads simultaneos', async () => {
  const rm = new ResourceManager({ maxConcurrentDownloads: 2 });
  const r1 = await rm.acquireDownload();
  const r2 = await rm.acquireDownload();
  assert.equal(rm.stats.downloads.available, 0);

  // O terceiro pedido espera; liberar um slot o desbloqueia.
  const r3p = rm.acquireDownload().then((release) => {
    release();
    return true;
  });
  await new Promise((r) => setTimeout(r, 10));
  r1();
  assert.equal(await r3p, true);
  r2();
});

test('ResourceManager: conexoes sao limitadas por download (transporte Range/turbo)', async () => {
  const rm = new ResourceManager({ maxConnectionsPerDownload: 4 });
  for (let i = 0; i < 4; i++) await rm.acquireConnection();
  assert.equal(rm.stats.connections.available, 0);
});

test('ResourceManager: acquireFfmpeg e acquireTempDir expostos', async () => {
  const rm = createDefaultResourceManager();
  const r1 = await rm.acquireFfmpeg();
  const r2 = await rm.acquireFfmpeg();
  assert.equal(rm.stats.ffmpeg.available, 0);
  r1();
  r2();

  const t1 = await rm.acquireTempDir();
  assert.equal(rm.stats.tempDirs.available, 7);
  t1();
});

test('ResourceManager: stats refletem liberacoes', async () => {
  const rm = createDefaultResourceManager();
  const r = await rm.acquireDownload();
  assert.equal(rm.stats.downloads.active, 1);
  assert.equal(rm.stats.downloads.available, 2);
  r();
  assert.equal(rm.stats.downloads.active, 0);
  assert.equal(rm.stats.downloads.available, 3);
});
