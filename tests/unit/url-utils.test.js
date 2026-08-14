import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_USER_AGENT, normalizeUrl, isValidM3u8Url, maskUrl } from '../../src/core/url-utils.js';

test('url-utils: DEFAULT_USER_AGENT is set', () => {
  assert.ok(DEFAULT_USER_AGENT.length > 10);
  assert.ok(DEFAULT_USER_AGENT.includes('Mozilla'));
});

test('url-utils: normalizeUrl extracts URL from markdown link', () => {
  assert.equal(normalizeUrl('[click](https://example.com)'), 'https://example.com');
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(null), '');
});

test('url-utils: normalizeUrl removes quotes and brackets', () => {
  assert.equal(normalizeUrl('"https://example.com"'), 'https://example.com');
  assert.equal(normalizeUrl('<https://example.com>'), 'https://example.com');
});

test('url-utils: isValidM3u8Url recognizes .m3u8', () => {
  assert.equal(isValidM3u8Url('https://example.com/v.m3u8'), true);
  assert.equal(isValidM3u8Url('https://example.com/v.mp4'), false);
  assert.equal(isValidM3u8Url('not-a-url'), false);
});

test('url-utils: maskUrl masks sensitive params', () => {
  const masked = maskUrl('https://example.com/v.m3u8?access_token=abc&sid=xyz&cP=123');
  assert.ok(masked.includes('access_token=***'));
  assert.ok(masked.includes('sid=***'));
  assert.ok(masked.includes('cP=123'), 'non-sensitive param preserved');
  assert.ok(!masked.includes('abc'));
  assert.ok(!masked.includes('xyz'));
});

test('url-utils: maskUrl handles invalid URLs gracefully', () => {
  assert.equal(maskUrl('not-a-url'), 'not-a-url');
  assert.equal(maskUrl(''), '');
});
