/**
 * P6.2 — Testes unitarios do Smart Turbo (src/core/smart-turbo.js).
 *
 * Heuristica pura: transicoes de concurrency sao testadas com amostras
 * sinteticas de janela (bytes/elapsedMs/errors), derivadas do baseline em
 * tests/performance/BASELINE.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSmartTurbo,
  normalizeSmartTurbo,
  isRetryableChunkError,
  SMART_TURBO_DEFAULTS,
} from '../../src/core/smart-turbo.js';
import { StreamGrabError, NetworkError, RateLimitError } from '../../src/core/errors.js';

/** Janela com throughput total constante (B/s) e concurrency ativa. */
const win = (totalBytesPerSec, active, { elapsedMs = 1000, errors = 0 } = {}) => ({
  bytes: Math.round(totalBytesPerSec * (elapsedMs / 1000)),
  elapsedMs,
  errors,
  concurrency: active,
});

test('smart-turbo: defaults e clamp de min/max/initial', () => {
  const t = createSmartTurbo();
  assert.equal(t.getConcurrency(), SMART_TURBO_DEFAULTS.initial);
  const cfg = t.config();
  assert.equal(cfg.min, 2);
  assert.equal(cfg.max, 12);

  // initial fora de [min,max] e clampado
  const t2 = createSmartTurbo({ min: 4, max: 8, initial: 1 });
  assert.equal(t2.getConcurrency(), 4);
  const t3 = createSmartTurbo({ min: 4, max: 8, initial: 99 });
  assert.equal(t3.getConcurrency(), 8);
  // min > max inverte para max = min
  const t4 = createSmartTurbo({ min: 10, max: 4 });
  assert.equal(t4.config().max, 10);
});

test('smart-turbo: rampa inicial sobe 2 -> 4 -> 8 -> 12 quando estavel', () => {
  const t = createSmartTurbo({ windowMs: 1000 });
  // Servidor sem throttle: por-conexao constante (total proporcional a active).
  let d1 = t.sample(win(4 * 1024 * 1024, 2)); // 4 MB/s total com 2 conexoes
  assert.equal(d1.concurrency, 2, 'primeira janela e referencia (hold)');

  let seq = [t.getConcurrency()];
  const samples = [
    win(4 * 1024 * 1024, 2), // perConn 2 MB/s (igual) -> rampa
    win(8 * 1024 * 1024, 4), // perConn 2 MB/s (igual) -> rampa
    win(16 * 1024 * 1024, 8), // perConn 2 MB/s (igual) -> rampa
  ];
  for (const s of samples) {
    t.sample(s);
    seq.push(t.getConcurrency());
  }
  assert.deepEqual(seq, [2, 4, 8, 12], `rampa esperada 2->4->8->12 (recebido ${seq})`);
});

test('smart-turbo: throttling agregado reduz e nao sobe durante o cooldown', () => {
  const t = createSmartTurbo({ windowMs: 1000 });
  // Subida limpa ate o max (12) com por-conexao estavel em 2 MB/s.
  t.sample(win(4 * 1024 * 1024, 2)); // ref
  t.sample(win(8 * 1024 * 1024, 2)); // -> 4
  t.sample(win(16 * 1024 * 1024, 4)); // -> 8
  t.sample(win(32 * 1024 * 1024, 8)); // -> 12
  assert.equal(t.getConcurrency(), 12);

  // Throttle agregado: total estagna em 24 MB/s; por-conexao cai de 4 MB/s
  // (24/8=3? nao: janela anterior tinha 32/8=4) para 24/12=2 MB/s -> -50%.
  const d = t.sample(win(24 * 1024 * 1024, 12));
  assert.equal(d.action, 'down');
  assert.equal(t.getConcurrency(), 6, '12 -> ceil(12*0.5)=6');
  assert.ok(d.cooldown > 0, 'entrou em cooldown');

  // Durante o cooldown, mesmo com total crescendo, NAO sobe.
  const d2 = t.sample(win(60 * 1024 * 1024, 6));
  assert.equal(d2.action, 'hold', 'cooldown impede subida');
  assert.equal(t.getConcurrency(), 6);
});

test('smart-turbo: erros retryable (429/5xx) forcam backoff imediato', () => {
  const t = createSmartTurbo();
  t.sample(win(4 * 1024 * 1024, 2));
  t.sample(win(8 * 1024 * 1024, 2));
  t.sample(win(16 * 1024 * 1024, 4));
  const before = t.getConcurrency();

  const d = t.sample(win(8 * 1024 * 1024, before, { errors: 2 }));
  assert.equal(d.action, 'down');
  assert.ok(t.getConcurrency() < before, 'erros reduzem a concurrency');
  assert.equal(d.reason.includes('erro(s) retryable'), true, `reason: ${d.reason}`);
});

test('smart-turbo: nunca ultrapassa max nem fica abaixo de min', () => {
  const t = createSmartTurbo({ min: 2, max: 4 });
  // Rampa ate 4 e para (perConn estavel em 0.5 B/s).
  t.sample(win(1, 2)); // ref
  t.sample(win(1, 2)); // rampa -> 4
  t.sample(win(2, 4)); // perConn 0.5 igual; rampa tenta 8, max 4 -> fica 4
  assert.equal(t.getConcurrency(), 4);
  const d = t.sample(win(999 * 1024 * 1024, 4));
  assert.equal(d.action, 'hold');
  assert.equal(t.getConcurrency(), 4, 'max e respeitado');

  // Backoff nunca fica abaixo de min.
  const t2 = createSmartTurbo({ min: 2, max: 4 });
  t2.sample(win(1, 2)); // ref
  t2.sample(win(1, 2)); // rampa -> 4
  t2.sample(win(2, 4)); // -> 4 (max)
  for (let i = 0; i < 6; i++) {
    t2.sample(win(2, 4, { errors: 1 })); // 4 -> 2 (backoff); depois trava no min
  }
  assert.equal(t2.getConcurrency(), 2, 'min e respeitado');
});

test('smart-turbo: no pico, queda suave (<30%) com total estagnado -> hold', () => {
  const t = createSmartTurbo();
  // Rampa limpa ate o max (12) com perConn 2 MB/s.
  t.sample(win(4 * 1024 * 1024, 2)); // ref
  t.sample(win(4 * 1024 * 1024, 2)); // -> 4
  t.sample(win(8 * 1024 * 1024, 4)); // -> 8
  t.sample(win(16 * 1024 * 1024, 8)); // -> 12
  assert.equal(t.getConcurrency(), 12);
  // Queda suave: 2 MB/s -> 1.67 MB/s por conexao (-17%) com total caindo 4%.
  const d = t.sample(win(20 * 1024 * 1024, 12));
  assert.equal(d.action, 'hold', `esperava hold (recebido ${d.action}: ${d.reason})`);
  assert.equal(t.getConcurrency(), 12);
  // Queda que cruza 30% dispara throttling.
  const d2 = t.sample(win(13 * 1024 * 1024, 12)); // 1.08 vs 1.67 = -35%
  assert.equal(d2.action, 'down', `esperava down (recebido ${d2.action}: ${d2.reason})`);
});

test('smart-turbo: reset restaura o estado inicial', () => {
  const t = createSmartTurbo();
  t.sample(win(4 * 1024 * 1024, 2));
  t.sample(win(8 * 1024 * 1024, 2));
  assert.ok(t.getConcurrency() > SMART_TURBO_DEFAULTS.initial);
  t.reset();
  assert.equal(t.getConcurrency(), SMART_TURBO_DEFAULTS.initial);
  assert.equal(t.lastDecision().samples, 0);
});

test('smart-turbo: normalizeSmartTurbo aceita boolean|objeto|null', () => {
  assert.equal(normalizeSmartTurbo(false), null);
  assert.equal(normalizeSmartTurbo(null), null);
  const t = normalizeSmartTurbo(true);
  assert.equal(t.max, SMART_TURBO_DEFAULTS.max);
  const o = normalizeSmartTurbo({ max: 6, windowMs: 500 });
  assert.equal(o.max, 6);
  assert.equal(o.windowMs, 500);
  assert.equal(o.min, SMART_TURBO_DEFAULTS.min, 'defaults preservados');
});

test('smart-turbo: isRetryableChunkError so reconhece 429/5xx retryable', () => {
  assert.equal(isRetryableChunkError(new RateLimitError('429', { status: 429 })), true);
  assert.equal(isRetryableChunkError(new NetworkError('500', { status: 500, retryable: true })), true);
  assert.equal(isRetryableChunkError(new StreamGrabError('x', { code: 'RANGE_UNSUPPORTED' })), false);
  assert.equal(isRetryableChunkError(new Error('generic')), false);
  assert.equal(isRetryableChunkError(null), false);
});
