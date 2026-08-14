import { test } from 'node:test';
import assert from 'node:assert/strict';

import { safeRefreshMdstrm } from '../../src/core/mdstrm-routing.js';

test('mdstrm-routing: safeRefreshMdstrm returns original for non-mdstrm URL', async () => {
  const url = 'https://example.com/video.mp4';
  const result = await safeRefreshMdstrm(url);
  assert.equal(result, url);
});

test('mdstrm-routing: safeRefreshMdstrm returns original for null/undefined', async () => {
  assert.equal(await safeRefreshMdstrm(null), null);
  assert.equal(await safeRefreshMdstrm(undefined), undefined);
  assert.equal(await safeRefreshMdstrm(''), '');
});

test('mdstrm-routing: safeRefreshMdstrm returns original when refresh fails', async () => {
  // mdstrm URL that needs refresh but will fail (no network)
  const url = 'https://cdn.mdstrm.com/video/abc123.m3u8?ot=token';
  const result = await safeRefreshMdstrm(url, null);
  // Should return original URL since refresh fails gracefully
  assert.equal(result, url);
});
