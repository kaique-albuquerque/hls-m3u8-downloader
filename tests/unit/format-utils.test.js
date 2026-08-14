import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatBytes, formatKbps } from '../../src/core/format-utils.js';

test('format-utils: formatBytes zero and negative', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes(NaN), '0 B');
});

test('format-utils: formatBytes various sizes', () => {
  assert.equal(formatBytes(100), '100 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1048576), '1.0 MB');
  assert.equal(formatBytes(1073741824), '1.0 GB');
});

test('format-utils: formatKbps zero and empty', () => {
  assert.equal(formatKbps(0), '');
  assert.equal(formatKbps(undefined), '');
});

test('format-utils: formatKbps various values', () => {
  assert.equal(formatKbps(500000), '500 Kbps');
  assert.equal(formatKbps(2500000), '2.50 Mbps');
});
