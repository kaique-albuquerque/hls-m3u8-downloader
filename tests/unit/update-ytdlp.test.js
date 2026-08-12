import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseVersion, pickAsset, targetPaths } from '../../scripts/update-ytdlp.mjs';

test('parseVersion extrai versão da saída do --version', () => {
  assert.equal(parseVersion('2026.08.01\n'), '2026.08.01');
  assert.equal(parseVersion('2026.08.1'), '2026.08'); // segmento com 1 dígito é ignorado
  assert.equal(parseVersion('2025.12.31\n'), '2025.12.31');
  assert.equal(parseVersion(''), '');
  assert.equal(parseVersion('not a version'), '');
  assert.equal(parseVersion('python: not found'), '');
});

test('pickAsset escolhe yt-dlp.exe no Windows e yt-dlp no Unix', () => {
  const assets = [
    { name: 'yt-dlp.exe', browser_download_url: 'https://x/yt-dlp.exe' },
    { name: 'yt-dlp.tar.gz', browser_download_url: 'https://x/tar' },
  ];
  assert.equal(pickAsset(assets, { platform: 'win32' }), 'https://x/yt-dlp.exe');
  assert.equal(pickAsset(assets, { platform: 'linux' }), null); // sem asset unix
  assert.equal(pickAsset([], { platform: 'win32' }), null);
  assert.equal(pickAsset(null, { platform: 'win32' }), null);
});

test('targetPaths: só retorna arquivos que existem', () => {
  const paths = targetPaths('Z:/nao-existe');
  assert.deepEqual(paths, []);
});
