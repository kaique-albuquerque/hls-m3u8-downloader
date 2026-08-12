import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectWindowsAsset } from '../../src/curlimp-install.js';

test('curlimp-install: escolhe ZIP de Windows x64', () => {
  const asset = selectWindowsAsset([
    { name: 'curl-impersonate-v0.6.1-linux-x86_64.tar.gz', browser_download_url: 'https://example.com/linux' },
    { name: 'curl-impersonate-v0.6.1-win64.zip', browser_download_url: 'https://example.com/win64' },
    { name: 'curl-impersonate-v0.6.1-windows-arm64.zip', browser_download_url: 'https://example.com/arm64' },
  ]);
  assert.equal(asset?.browser_download_url, 'https://example.com/win64');
});

test('curlimp-install: aceita asset Windows x86_64 em tar.gz', () => {
  const asset = selectWindowsAsset([
    { name: 'curl-impersonate-v1.0.0-x86_64-pc-windows-msvc.tar.gz', browser_download_url: 'https://example.com/msvc' },
    { name: 'curl-impersonate-v1.0.0-aarch64-pc-windows-msvc.tar.gz', browser_download_url: 'https://example.com/arm64' },
  ]);
  assert.equal(asset?.browser_download_url, 'https://example.com/msvc');
});

test('curlimp-install: retorna null sem asset compativel', () => {
  const asset = selectWindowsAsset([
    { name: 'curl-impersonate-v0.6.1-linux-x86_64.tar.gz' },
    { name: 'curl-impersonate-v0.6.1-macos.zip' },
  ]);
  assert.equal(asset, null);
});
