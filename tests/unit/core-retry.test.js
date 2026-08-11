// P4 — core/retry: backoff exponencial + jitter, Retry-After, cancelamento.
//
// Cobre (plano §16/§41):
//  - backoff exponencial com fator 2 e teto em maxDelayMs
//  - jitter 50-100% do atraso nominal
//  - Retry-After em segundos e em data HTTP
//  - erros permanentes NUNCA sao retentados
//  - maxAttempts respeitado
//  - cancelamento durante o backoff (signal)

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeBackoffDelay,
  parseRetryAfter,
  retryAfterFromError,
  retryWithBackoff,
  sleep,
} from '../../src/core/retry.js';
import { NetworkError, ForbiddenError, CancelledError, RateLimitError, StreamGrabError } from '../../src/core/errors.js';

test('computeBackoffDelay: dobra a cada tentativa com fator 2', () => {
  assert.equal(computeBackoffDelay(0, { baseDelayMs: 500, jitter: false }), 500);
  assert.equal(computeBackoffDelay(1, { baseDelayMs: 500, jitter: false }), 1000);
  assert.equal(computeBackoffDelay(2, { baseDelayMs: 500, jitter: false }), 2000);
  assert.equal(computeBackoffDelay(3, { baseDelayMs: 500, jitter: false }), 4000);
});

test('computeBackoffDelay: respeita o teto maxDelayMs', () => {
  const capped = computeBackoffDelay(10, { baseDelayMs: 500, maxDelayMs: 30000, jitter: false });
  assert.equal(capped, 30000);
});

test('computeBackoffDelay: jitter fica entre 50% e 100% do atraso nominal', () => {
  for (let i = 0; i < 50; i++) {
    const base = computeBackoffDelay(3, { baseDelayMs: 1000, jitter: false }); // 8000
    const j = computeBackoffDelay(3, { baseDelayMs: 1000, jitter: true });
    assert.ok(j >= base / 2 && j <= base, `jitter fora da faixa: ${j} vs base ${base}`);
  }
});

test('parseRetryAfter: segundos inteiros -> ms', () => {
  assert.equal(parseRetryAfter('5'), 5000);
  assert.equal(parseRetryAfter(2), 2000);
  assert.equal(parseRetryAfter('0'), 0);
});

test('parseRetryAfter: data HTTP -> ms restantes', () => {
  const future = new Date(Date.now() + 3000).toUTCString();
  const ms = parseRetryAfter(future);
  assert.ok(ms != null && ms > 0 && ms <= 3000, `esperado ate 3000ms, recebido ${ms}`);
});

test('parseRetryAfter: invalido -> null', () => {
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('abc'), null);
});

test('retryAfterFromError: propriedade retryAfter direta', () => {
  const err = new RateLimitError('429', { status: 429 });
  err.retryAfter = '3';
  assert.equal(retryAfterFromError(err), 3000);
});

test('retryAfterFromError: headers do fetch (Headers)', () => {
  const err = new RateLimitError('429', { status: 429 });
  err.headers = new Headers({ 'retry-after': '7' });
  assert.equal(retryAfterFromError(err), 7000);
});

test('retryAfterFromError: objeto de headers simples', () => {
  const err = new RateLimitError('429', { status: 429 });
  err.headers = { 'Retry-After': '9' };
  assert.equal(retryAfterFromError(err), 9000);
});

test('sleep: resolve apos o tempo; aborta com CANCELLED no signal', async () => {
  const ac = new AbortController();
  const p = sleep(5000, ac.signal);
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, (err) => err.code === 'CANCELLED');
});

test('retryWithBackoff: sucesso na 2a tentativa (retry de erro retryable)', async () => {
  let calls = 0;
  const result = await retryWithBackoff({
    fn: async () => {
      calls++;
      if (calls === 1) throw new NetworkError('timeout', { retryable: true });
      return 'ok';
    },
    maxAttempts: 3,
    baseDelayMs: 1,
    maxDelayMs: 5,
    jitter: false,
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('retryWithBackoff: erro permanente (403/Forbidden) nunca e retentado', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff({
      fn: async () => {
        calls++;
        throw new ForbiddenError('403', { status: 403 });
      },
      maxAttempts: 5,
      baseDelayMs: 1,
    }),
    (err) => err instanceof ForbiddenError
  );
  assert.equal(calls, 1, '403 nao pode disparar retry (nem loop de transports)');
});

test('retryWithBackoff: cancela durante o backoff com signal', async () => {
  const ac = new AbortController();
  const p = retryWithBackoff({
    fn: async () => {
      throw new NetworkError('temporario', { retryable: true });
    },
    maxAttempts: 5,
    baseDelayMs: 100000, // dormiria muito; o abort interrompe
    maxDelayMs: 100000,
    jitter: false,
    signal: ac.signal,
  });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, (err) => err.code === 'CANCELLED' || err instanceof NetworkError);
});

test('retryWithBackoff: respeita Retry-After em vez do backoff', async () => {
  let calls = 0;
  const delays = [];
  await assert.rejects(
    retryWithBackoff({
      fn: async () => {
        calls++;
        const err = new RateLimitError('429', { status: 429 });
        err.retryAfter = '1'; // 1000ms
        throw err;
      },
      maxAttempts: 2,
      baseDelayMs: 999999, // se usasse backoff, dormiria muito mais
      maxDelayMs: 999999,
      jitter: false,
      onRetry: ({ delay }) => delays.push(delay),
    }),
    (err) => err instanceof RateLimitError
  );
  assert.equal(calls, 2);
  assert.equal(delays.length, 1);
  assert.equal(delays[0], 1000, 'Retry-After deve prevalecer sobre o backoff');
});

test('retryWithBackoff: onRetry recebe a tentativa e o atraso', async () => {
  let calls = 0;
  const seen = [];
  await assert.rejects(
    retryWithBackoff({
      fn: async () => {
        calls++;
        throw new NetworkError('x', { retryable: true });
      },
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 4,
      jitter: false,
      onRetry: ({ attempt, delay, error }) => seen.push({ attempt, delay, error }),
    }),
    (err) => err instanceof NetworkError
  );
  assert.equal(calls, 3);
  assert.deepEqual(
    seen.map((s) => [s.attempt, s.delay]),
    [
      [0, 1],
      [1, 2],
    ]
  );
});

test('retryWithBackoff: erro nao-StreanGrabError nao retryable por padrao', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff({
      fn: async () => {
        calls++;
        throw new Error('erro generico');
      },
      maxAttempts: 4,
    })
  );
  assert.equal(calls, 1);
});

test('retryWithBackoff: maxAttempts=1 nao retenta', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff({
      fn: async () => {
        calls++;
        throw new NetworkError('x', { retryable: true });
      },
      maxAttempts: 1,
    })
  );
  assert.equal(calls, 1);
});

test('retryWithBackoff: shouldRetry customizado pode retentar StreamGrabError comum', async () => {
  let calls = 0;
  const result = await retryWithBackoff({
    fn: async () => {
      calls++;
      if (calls === 1) throw new StreamGrabError('temporario', { code: 'TEMP' });
      return 'ok';
    },
    shouldRetry: (err) => err?.code === 'TEMP',
    maxAttempts: 3,
    baseDelayMs: 1,
    maxDelayMs: 4,
    jitter: false,
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});
