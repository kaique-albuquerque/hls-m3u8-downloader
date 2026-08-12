import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createEventBus,
  createProgressPayload,
  EVENT_NAMES,
  DOWNLOAD_EVENT_NAMES,
  JOB_STAGES,
  isValidEventName,
} from '../../src/core/events.js';

test('core-events: nomes de eventos conforme o plano', () => {
  assert.deepEqual(EVENT_NAMES, [
    'start',
    'progress',
    'speed',
    'eta',
    'pause',
    'resume',
    'complete',
    'error',
    'cancel',
    // P11.1: diagnostico sanitizado (roteamento mdstrm etc.) — a UI exibe
    // no log do job; nunca contem tokens completos de sessao.
    'log',
  ]);
  assert.deepEqual(DOWNLOAD_EVENT_NAMES, EVENT_NAMES.map((n) => `download:${n}`));
  for (const name of EVENT_NAMES) assert.equal(isValidEventName(name), true);
  assert.equal(isValidEventName('bogus'), false);
  assert.equal(isValidEventName(''), false);
});

test('core-events: subscribe/emit recebe payload', () => {
  const bus = createEventBus();
  const received = [];
  bus.on('progress', (payload) => received.push(payload));
  bus.emit('progress', createProgressPayload({ bytesDownloaded: 10, totalBytes: 100, percent: 10 }));
  assert.equal(received.length, 1);
  assert.equal(received[0].bytesDownloaded, 10);
  assert.equal(received[0].percent, 10);
});

test('core-events: aceita alias download:<nome>', () => {
  const bus = createEventBus();
  const received = [];
  bus.on('download:progress', (p) => received.push(p));
  bus.emit('progress', { percent: 50 });
  bus.emit('download:progress', { percent: 75 });
  assert.equal(received.length, 2);
  assert.equal(received[1].percent, 75);
});

test('core-events: once dispara uma unica vez', () => {
  const bus = createEventBus();
  let count = 0;
  bus.once('complete', () => {
    count += 1;
  });
  bus.emit('complete');
  bus.emit('complete');
  assert.equal(count, 1);
});

test('core-events: off remove handler', () => {
  const bus = createEventBus();
  let count = 0;
  const handler = () => {
    count += 1;
  };
  bus.on('start', handler);
  bus.emit('start');
  bus.off('start', handler);
  bus.emit('start');
  assert.equal(count, 1);
  assert.equal(bus.handlerCount('start'), 0);
});

test('core-events: unsubscribe retornado pelo on tambem remove', () => {
  const bus = createEventBus();
  let count = 0;
  const unsubscribe = bus.on('speed', () => {
    count += 1;
  });
  bus.emit('speed', { speed: '1 MB/s' });
  unsubscribe();
  bus.emit('speed', { speed: '2 MB/s' });
  assert.equal(count, 1);
});

test('core-events: multiplos handlers no mesmo evento', () => {
  const bus = createEventBus();
  const seen = [];
  bus.on('error', () => seen.push('a'));
  bus.on('error', () => seen.push('b'));
  bus.emit('error', { message: 'x' });
  assert.deepEqual(seen.sort(), ['a', 'b']);
});

test('core-events: evento sem handlers nao lanca', () => {
  const bus = createEventBus();
  bus.emit('progress', { percent: 1 });
  bus.emit('cancel');
});

test('core-events: erro em handler nao derruba o emissor', () => {
  const bus = createEventBus();
  const errors = [];
  const bus2 = createEventBus({ onHandlerError: (err, key) => errors.push([err.message, key]) });
  bus2.on('progress', () => {
    throw new Error('boom');
  });
  bus2.on('progress', () => {
    /* segundo handler ainda roda */
  });
  assert.doesNotThrow(() => bus2.emit('progress', { percent: 1 }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], 'boom');
  assert.equal(errors[0][1], 'progress');

  // sem onHandlerError: silencioso, sem derrubar
  bus.on('error', () => {
    throw new Error('boom2');
  });
  assert.doesNotThrow(() => bus.emit('error', { message: 'x' }));
});

test('core-events: evento invalido lanca no on/emit', () => {
  const bus = createEventBus();
  assert.throws(() => bus.on('bogus', () => {}), TypeError);
  assert.throws(() => bus.emit('bogus'), TypeError);
});

test('core-events: payload padronizado completo', () => {
  const payload = createProgressPayload();
  assert.equal(payload.bytesDownloaded, 0);
  assert.equal(payload.totalBytes, 0);
  assert.equal(payload.percent, 0);
  assert.equal(payload.speed, '');
  assert.equal(payload.etaSeconds, null);
  assert.equal(payload.stage, 'queued');
  assert.equal(payload.chunks, 1);
  assert.equal(payload.muxStatus, '');
  assert.equal(payload.message, '');
});

test('core-events: createProgressPayload preserva overrides e ignora extras', () => {
  const payload = createProgressPayload({ percent: 42, speed: '1 MB/s', etaSeconds: 30, extra: 1 });
  assert.equal(payload.percent, 42);
  assert.equal(payload.speed, '1 MB/s');
  assert.equal(payload.etaSeconds, 30);
  assert.equal(payload.extra, 1);
});

test('core-events: JOB_STAGES cobre etapas do pipeline', () => {
  assert.deepEqual(JOB_STAGES, ['queued', 'analyzing', 'preparing', 'downloading', 'merging']);
});

test('core-events: emit com payload null/undefined vira objeto vazio', () => {
  const bus = createEventBus();
  const received = [];
  bus.on('resume', (p) => received.push(p));
  bus.emit('resume');
  bus.emit('resume', null);
  bus.emit('resume', { stage: 'downloading' });
  assert.equal(received.length, 3);
  assert.deepEqual(received[0], {});
  assert.equal(received[2].stage, 'downloading');
});
