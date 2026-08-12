import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PROJECT_ROOT,
  RESOURCES_PATH_ENV,
  binName,
  getPackagedResourcesPath,
  packagedBinaryPath,
  hasPackagedBinary,
  getYtDlpExec,
  resetYtDlpCache,
} from '../../src/core/binaries.js';
import { getFfmpegCommand } from '../../src/ffmpeg/service.js';

afterEach(() => {
  delete process.env[RESOURCES_PATH_ENV];
  resetYtDlpCache();
});

test('binName adiciona .exe no Windows', () => {
  const name = binName('ffmpeg');
  assert.ok(
    name === 'ffmpeg.exe' || name === 'ffmpeg',
    `binName deve terminar com .exe no Windows ou ser o nome puro: ${name}`
  );
});

test('getPackagedResourcesPath: sem env retorna string vazia, com env retorna o valor', () => {
  assert.equal(getPackagedResourcesPath(), '');
  process.env[RESOURCES_PATH_ENV] = '   ';
  assert.equal(getPackagedResourcesPath(), '');
  process.env[RESOURCES_PATH_ENV] = 'C:\\Program Files\\StreamGrab\\resources';
  assert.equal(getPackagedResourcesPath(), 'C:\\Program Files\\StreamGrab\\resources');
});

test('packagedBinaryPath junta root/bin/nome', () => {
  assert.equal(packagedBinaryPath('ffmpeg.exe'), '');
  process.env[RESOURCES_PATH_ENV] = 'R:/resources';
  assert.equal(packagedBinaryPath('ffmpeg.exe'), path.join('R:/resources', 'bin', 'ffmpeg.exe'));
});

test('hasPackagedBinary usa fs injetável', () => {
  const fakeFs = { existsSync: () => true };
  process.env[RESOURCES_PATH_ENV] = 'R:/resources';
  assert.equal(hasPackagedBinary('ffmpeg.exe', { fsImpl: fakeFs }), true);
  fakeFs.existsSync = () => false;
  assert.equal(hasPackagedBinary('ffmpeg.exe', { fsImpl: fakeFs }), false);
  // Sem env → sempre false, mesmo com fs "verdadeiro"
  delete process.env[RESOURCES_PATH_ENV];
  assert.equal(hasPackagedBinary('ffmpeg.exe', { fsImpl: fakeFs }), false);
});

test('getYtDlpExec: dev usa instância default do youtube-dl-exec', async () => {
  const exec = await getYtDlpExec();
  assert.equal(typeof exec, 'function');
  assert.equal(typeof exec.exec, 'function');
  const exec2 = await getYtDlpExec();
  assert.equal(exec, exec2); // cache
});

test('getYtDlpExec: produção usa create() com binário empacotado', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-bin-'));
  try {
    process.env[RESOURCES_PATH_ENV] = tmp;
    const fakeFs = { existsSync: (p) => p.endsWith(path.join('bin', binName('yt-dlp'))) };
    const exec = await getYtDlpExec({ fsImpl: fakeFs });
    assert.equal(typeof exec, 'function');
    assert.equal(typeof exec.exec, 'function');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getFfmpegCommand: binário empacotado tem prioridade', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-bin-'));
  try {
    const fakeExe = path.join(tmp, 'bin', binName('ffmpeg'));
    fs.mkdirSync(path.dirname(fakeExe), { recursive: true });
    fs.writeFileSync(fakeExe, 'x');
    process.env[RESOURCES_PATH_ENV] = tmp;
    assert.equal(getFfmpegCommand(), fakeExe);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getFfmpegCommand: sem env volta ao comportamento dev', () => {
  const cmd = getFfmpegCommand();
  assert.ok(typeof cmd === 'string' && cmd.length > 0);
});

test('PROJECT_ROOT aponta para a raiz do projeto', () => {
  assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'package.json')));
});
