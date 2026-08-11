// P5 — FfmpegService (src/ffmpeg/service.js). Unit com spawn fake.
//
// O spawn é injetado (constructor), então não há dependência do binário:
// cobre parse de progresso (-progress pipe:1), resolve de close/error,
// stop() gracioso (stdin 'q' + interrupted), AbortSignal (incl. pré-abortado)
// e limpeza de listeners.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, getEventListeners } from 'node:events';

import { FfmpegService } from '../../src/ffmpeg/service.js';

/** Cria um child fake no formato esperado pelo service.run(). */
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { writable: true, write: () => {} };
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.exitCode = null;
  };
  child.pid = 4242;
  return child;
}

function makeService() {
  const spawned = [];
  const service = new FfmpegService({
    getCommand: () => 'ffmpeg-fake',
    spawnFn: (cmd, args, opts) => {
      const child = makeFakeChild();
      spawned.push({ cmd, args, opts, child });
      return child;
    },
  });
  return { service, spawned };
}

test('service: close(0) sem stop resolve ok:true', async () => {
  const { service, spawned } = makeService();
  const { promise } = service.run({ args: ['-y', '-i', 'in', 'out'] });
  const { child } = spawned[0];
  child.emit('close', 0);
  const r = await promise;
  assert.deepEqual(r, { ok: true, code: 0, stderr: '', interrupted: false });
});

test('service: close(1) resolve ok:false com codigo', async () => {
  const { service, spawned } = makeService();
  const { promise } = service.run({ args: ['-y'] });
  spawned[0].child.emit('close', 1);
  const r = await promise;
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
});

test('service: progresso do -progress pipe:1 e repassado como chave/valor', async () => {
  const { service, spawned } = makeService();
  const progress = [];
  const { promise } = service.run({ args: ['-y'], onProgress: (kv) => progress.push(kv) });
  const { child } = spawned[0];
  child.stdout.emit('data', Buffer.from('out_time_us=500000\nprogress=continue\n'));
  child.stdout.emit('data', Buffer.from('total_size=1024\n'));
  child.emit('close', 0);
  await promise;
  assert.deepEqual(progress, [
    { key: 'out_time_us', value: '500000' },
    { key: 'progress', value: 'continue' },
    { key: 'total_size', value: '1024' },
  ]);
});

test('service: spawn lancando erro resolve ok:false sincronamente', async () => {
  const service = new FfmpegService({
    getCommand: () => 'ffmpeg-fake',
    spawnFn: () => {
      throw new Error('spawn falhou');
    },
  });
  const { promise } = service.run({ args: ['-y'] });
  const r = await promise;
  assert.equal(r.ok, false);
  assert.equal(r.code, -1);
  assert.equal(r.error.message, 'spawn falhou');
  assert.equal(r.interrupted, false);
});

test('service: stderr e coletado (tail) e presente no resultado', async () => {
  const { service, spawned } = makeService();
  const { promise } = service.run({ args: ['-y'] });
  const { child } = spawned[0];
  child.stderr.emit('data', 'linha1\n');
  child.stderr.emit('data', 'linha2 com acento ã\n');
  child.emit('close', 1);
  const r = await promise;
  assert.match(r.stderr, /linha1/);
  assert.match(r.stderr, /linha2 com acento/);
});

test('service: stop() marca interrupted e escreve q no stdin', async () => {
  const { service, spawned } = makeService();
  const writes = [];
  const { promise, stop } = service.run({ args: ['-y'] });
  spawned[0].child.stdin = { writable: true, write: (d) => writes.push(d) };
  stop();
  const { child } = spawned[0];
  child.emit('close', 0);
  const r = await promise;
  assert.deepEqual(writes, ['q'], 'stop() deve pedir saida graciosa via stdin');
  assert.equal(r.ok, false, 'interrompido nunca conclui ok');
  assert.equal(r.interrupted, true);
});

test('service: abort do AbortSignal interrompe o processo', async () => {
  const { service, spawned } = makeService();
  const writes = [];
  const ac = new AbortController();
  const { promise } = service.run({ args: ['-y'], signal: ac.signal });
  spawned[0].child.stdin = { writable: true, write: (d) => writes.push(d) };
  ac.abort();
  const { child } = spawned[0];
  child.emit('close', 0);
  const r = await promise;
  assert.deepEqual(writes, ['q'], 'abort deve disparar stop()');
  assert.equal(r.interrupted, true);
});

test('service: signal pre-abortado ja nasce interrompido', async () => {
  const { service, spawned } = makeService();
  const ac = new AbortController();
  ac.abort();
  const { promise } = service.run({ args: ['-y'], signal: ac.signal });
  const { child } = spawned[0];
  child.emit('close', 0);
  const r = await promise;
  assert.equal(r.interrupted, true);
  assert.equal(r.ok, false);
});

test('service: listener de abort e removido apos o close (sem vazamento)', async () => {
  const { service, spawned } = makeService();
  const ac = new AbortController();
  const { promise } = service.run({ args: ['-y'], signal: ac.signal });
  const { child } = spawned[0];
  assert.equal(getEventListeners(ac.signal, 'abort').length, 1, 'listener registrado durante a execucao');
  child.emit('close', 0);
  await promise;
  assert.equal(getEventListeners(ac.signal, 'abort').length, 0, 'listener removido apos o close');
});

test('service: sem signal, nenhum listener e registrado', async () => {
  const { service, spawned } = makeService();
  const { promise } = service.run({ args: ['-y'] });
  spawned[0].child.emit('close', 0);
  await promise;
  assert.equal(spawned[0].child.listenerCount('error'), 1, 'listener de error permanece');
});

test('service: run usa o comando resolvido pelo getCommand injetado', async () => {
  const { service, spawned } = makeService();
  const { promise } = service.run({ args: ['-y', '-i', 'in.mp4', 'out.mp4'] });
  spawned[0].child.emit('close', 0);
  await promise;
  assert.equal(spawned[0].cmd, 'ffmpeg-fake');
  assert.deepEqual(spawned[0].args, ['-y', '-i', 'in.mp4', 'out.mp4']);
  assert.deepEqual(spawned[0].opts, { windowsHide: true });
});
