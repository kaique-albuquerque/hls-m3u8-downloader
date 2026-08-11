// Integration: deteccao do curl-impersonate (findCurlImpersonate).
//
// Usa um diretorio temporario apontado por LOCALAPPDATA para nao tocar em
// tools/ real nem depender de instalacao. Cobre (plano §28 - Integration):
//  - v2.x: curl-impersonate.exe + perfis .bat (chrome146 preferido)
//  - v1.x: binarios standalone ordenados por versao do Chrome (desc)
//  - nenhum binario -> null
//
// Sem rede externa e sem FFmpeg.

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findCurlImpersonate } from '../../src/curlimp.js';

const ORIGINAL_LOCALAPPDATA = process.env.LOCALAPPDATA;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;

after(() => {
  if (ORIGINAL_LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = ORIGINAL_LOCALAPPDATA;
  if (ORIGINAL_USERPROFILE === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = ORIGINAL_USERPROFILE;
});

function makeFakeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-curl-'));
  process.env.LOCALAPPDATA = root;
  process.env.USERPROFILE = root;
  return root;
}

function fakeDir(root) {
  const dir = path.join(root, 'curl-impersonate');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('curl-impersonate: v2.x com perfis - chrome146 e o preferido', () => {
  const dir = fakeDir(makeFakeRoot());
  const exe = path.join(dir, 'curl-impersonate.exe');
  fs.writeFileSync(exe, 'fake');
  fs.writeFileSync(path.join(dir, 'curl_chrome146.bat'), '');
  fs.writeFileSync(path.join(dir, 'curl_firefox135.bat'), '');
  fs.writeFileSync(path.join(dir, 'curl_chrome101.bat'), '');

  const found = findCurlImpersonate();
  assert.ok(found, 'deve encontrar o v2.x');
  assert.equal(found.name, 'curl-impersonate.exe');
  assert.equal(found.cmd, exe);
  assert.equal(found.profile, 'chrome146', 'PROFILE_ORDER prefere chrome146 sobre firefox135/chrome101');
});

test('curl-impersonate: v2.x sem perfil conhecido - profile undefined', () => {
  const dir = fakeDir(makeFakeRoot());
  fs.writeFileSync(path.join(dir, 'curl-impersonate.exe'), 'fake');
  fs.writeFileSync(path.join(dir, 'curl_unknown99.bat'), '');

  const found = findCurlImpersonate();
  assert.ok(found);
  assert.equal(found.name, 'curl-impersonate.exe');
  assert.equal(found.profile, undefined, 'perfil desconhecido nao entra no PROFILE_ORDER');
});

test('curl-impersonate: v1.x standalone ordenado por versao do Chrome (desc)', () => {
  const dir = fakeDir(makeFakeRoot());
  fs.writeFileSync(path.join(dir, 'curl_chrome101.exe'), 'fake');
  fs.writeFileSync(path.join(dir, 'curl_chrome999.exe'), 'fake');
  fs.writeFileSync(path.join(dir, 'curl_edge101.exe'), 'fake');

  const found = findCurlImpersonate();
  assert.ok(found);
  assert.equal(found.name, 'curl_chrome999.exe', 'deve escolher a versao mais recente');
  assert.equal(found.profile, undefined);
});

test('curl-impersonate: sem binarios em lugar nenhum -> null', () => {
  makeFakeRoot(); // diretorio vazio
  const found = findCurlImpersonate();
  assert.equal(found, null);
});
