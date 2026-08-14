import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CircuitBreaker } from '../../src/adapters/ytdlp.js';

test('circuit-breaker: starts closed (not open)', () => {
  const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 1000 });
  assert.equal(cb.isOpen(), false);
});

test('circuit-breaker: opens after threshold failures', () => {
  const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
  cb.recordFailure();
  assert.equal(cb.isOpen(), false);
  cb.recordFailure();
  assert.equal(cb.isOpen(), false);
  cb.recordFailure();
  assert.equal(cb.isOpen(), true);
});

test('circuit-breaker: success resets failures', () => {
  const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
  cb.recordFailure();
  cb.recordFailure();
  cb.recordSuccess();
  cb.recordFailure();
  assert.equal(cb.isOpen(), false); // only 1 failure after reset
});

test('circuit-breaker: half-open after cooldown', async () => {
  const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 50 });
  cb.recordFailure();
  cb.recordFailure();
  assert.equal(cb.isOpen(), true);

  // Wait for cooldown
  await new Promise((r) => setTimeout(r, 60));

  // Half-open: isOpen returns false, allows one try
  assert.equal(cb.isOpen(), false);
});

test('circuit-breaker: reset clears state', () => {
  const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 60_000 });
  cb.recordFailure();
  cb.recordFailure();
  assert.equal(cb.isOpen(), true);
  cb.reset();
  assert.equal(cb.isOpen(), false);
});
