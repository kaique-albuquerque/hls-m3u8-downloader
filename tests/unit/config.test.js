import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  loadConfig,
  parseCliHeaders,
  parseCliAuth,
  isGoogleVideoPlaybackUrl,
  collectDevtoolsHeaders,
} from '../../src/cli/config.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-config-'));
}

const silentIo = { log() {} };

// ---- loadConfig ----
test('config loadConfig: sem config.json retorna defaults', () => {
  const dir = tempDir();
  const config = loadConfig(dir, silentIo);
  assert.deepEqual(config, { headers: {}, cookiesFile: '', cookiesFromBrowser: '', turbo: false, turboChunks: 8 });
});

test('config loadConfig: config.json completo', () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      headers: { Referer: 'https://example.com' },
      cookiesFile: 'cookies.txt',
      cookiesFromBrowser: 'chrome',
      turbo: true,
      turboChunks: 4,
    })
  );
  const config = loadConfig(dir, silentIo);
  assert.equal(config.headers.Referer, 'https://example.com');
  assert.equal(config.cookiesFile, path.resolve(dir, 'cookies.txt'));
  assert.equal(config.cookiesFromBrowser, 'chrome');
  assert.equal(config.turbo, true);
  assert.equal(config.turboChunks, 4);
});

test('config loadConfig: turboChunks invalido cai para 8', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ turboChunks: -2 }));
  assert.equal(loadConfig(dir, silentIo).turboChunks, 8);
});

test('config loadConfig: JSON invalido loga aviso e usa defaults', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'config.json'), '{nao-e-json');
  const logs = [];
  const config = loadConfig(dir, { log: (msg) => logs.push(msg) });
  assert.deepEqual(config, { headers: {}, cookiesFile: '', cookiesFromBrowser: '', turbo: false, turboChunks: 8 });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /AVISO.*config\.json/);
});

// ---- parseCliHeaders ----
test('config parseCliHeaders: mapeia flags para headers canonicos', () => {
  const headers = parseCliHeaders([
    'node', 'index.js',
    '--referer', 'https://ref.example.com',
    '--origin', 'https://origin.example.com',
    '--user-agent', 'UA-test',
    '--cookie', 'session=abc',
  ]);
  assert.deepEqual(headers, {
    Referer: 'https://ref.example.com',
    Origin: 'https://origin.example.com',
    'User-Agent': 'UA-test',
    Cookie: 'session=abc',
  });
});

test('config parseCliHeaders: flag sem valor e ignorada', () => {
  const headers = parseCliHeaders(['node', 'index.js', '--referer']);
  assert.deepEqual(headers, {});
});

// ---- parseCliAuth ----
test('config parseCliAuth: extrai cookies file e browser', () => {
  const auth = parseCliAuth(['node', 'index.js', '--cookies', 'c.txt', '--cookies-from-browser', 'edge']);
  assert.equal(auth.cookiesFile, 'c.txt');
  assert.equal(auth.cookiesFromBrowser, 'edge');
});

test('config parseCliAuth: sem flags retorna vazio', () => {
  assert.deepEqual(parseCliAuth(['node', 'index.js']), { cookiesFile: '', cookiesFromBrowser: '' });
});

// ---- isGoogleVideoPlaybackUrl ----
test('config isGoogleVideoPlaybackUrl: apenas googlevideo/videoplayback', () => {
  assert.equal(isGoogleVideoPlaybackUrl('https://redirector.googlevideo.com/videoplayback?ip=1'), true);
  assert.equal(isGoogleVideoPlaybackUrl('https://r1---sn.example.googlevideo.com/videoplayback?x=1'), true);
  assert.equal(isGoogleVideoPlaybackUrl('https://www.youtube.com/watch?v=abc'), false);
  assert.equal(isGoogleVideoPlaybackUrl('https://redirector.googlevideo.com/other'), false);
  assert.equal(isGoogleVideoPlaybackUrl('nao-e-url'), false);
});

// ---- collectDevtoolsHeaders ----
test('config collectDevtoolsHeaders: mergeia com currentHeaders e normaliza', async () => {
  const answers = ['https://ref.example.com', '', 'UA-nova', 'cookie=1'];
  let i = 0;
  const ask = async () => answers[i++];
  const headers = await collectDevtoolsHeaders(ask, silentIo, { Referer: 'atual', 'User-Agent': 'atual-ua' });
  assert.deepEqual(headers, {
    Referer: 'https://ref.example.com',
    'User-Agent': 'UA-nova',
    Cookie: 'cookie=1',
  });
});

test('config collectDevtoolsHeaders: tudo vazio mantem currentHeaders', async () => {
  const ask = async () => '';
  const headers = await collectDevtoolsHeaders(ask, silentIo, { Referer: 'mantido' });
  assert.deepEqual(headers, { Referer: 'mantido' });
});
