import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_SETTINGS, normalizeSettings, createSettingsStore } from '../../src/core/settings.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-settings-test-'));
}

// ---------------------------------------------------------------------------
// DEFAULT_SETTINGS / normalizeSettings
// ---------------------------------------------------------------------------

test('DEFAULT_SETTINGS tem as 10 chaves do plano (seção 22)', () => {
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), [
    'audio',
    'defaultDir',
    'defaultQuality',
    'historyRetentionDays',
    'maxConcurrentDownloads',
    'notifications',
    'onComplete',
    'theme',
    'turbo',
    'turboChunks',
  ]);
});

test('normalizeSettings ignora chaves desconhecidas (typos nao corrompem)', () => {
  const out = normalizeSettings({ maxConcurrentDownloads: 4, turbo: true, maxConcurrentDownload: 9, 'versio ': 1 });
  assert.deepEqual(out, { maxConcurrentDownloads: 4, turbo: true });
});

test('normalizeSettings aplica clamps numericos', () => {
  assert.equal(normalizeSettings({ maxConcurrentDownloads: 999 }).maxConcurrentDownloads, 16);
  assert.equal(normalizeSettings({ maxConcurrentDownloads: 0 }).maxConcurrentDownloads, 1);
  assert.equal(normalizeSettings({ turboChunks: 99 }).turboChunks, 32);
  assert.equal(normalizeSettings({ turboChunks: -5 }).turboChunks, 1);
  assert.equal(normalizeSettings({ historyRetentionDays: 5000 }).historyRetentionDays, 3650);
  assert.equal(normalizeSettings({ historyRetentionDays: -1 }).historyRetentionDays, 0);
});

test('normalizeSettings coage tipos (NaN mantem default; string vira numero)', () => {
  assert.equal(normalizeSettings({ maxConcurrentDownloads: 'abc' }).maxConcurrentDownloads, 3);
  assert.equal(normalizeSettings({ maxConcurrentDownloads: '5' }).maxConcurrentDownloads, 5);
  assert.equal(normalizeSettings({ notifications: 0 }).notifications, false);
  assert.equal(normalizeSettings({ notifications: 'sim' }).notifications, true);
});

test('normalizeSettings ignora version e nao aceita null', () => {
  assert.deepEqual(normalizeSettings({ version: 9, turbo: true }), { turbo: true });
  assert.deepEqual(normalizeSettings(null), {});
});

// ---------------------------------------------------------------------------
// createSettingsStore
// ---------------------------------------------------------------------------

test('createSettingsStore exige file (ou storage injetavel)', () => {
  assert.throws(() => createSettingsStore(), TypeError);
  assert.throws(() => createSettingsStore({}), TypeError);
  // storage injetavel (teste sem disco)
  const fakeStorage = {
    file: 'fake.json',
    _d: {},
    load() { this._d = { version: 1, ...DEFAULT_SETTINGS }; },
    get() { return this._d; },
    save(d) { this._d = d; },
  };
  const s = createSettingsStore({ storage: fakeStorage });
  assert.equal(s.get('turbo'), false);
});

test('get/set/update/reset com persistencia real', () => {
  const file = path.join(makeTempDir(), 'settings.json');
  const store = createSettingsStore({ file });
  assert.equal(store.get('maxConcurrentDownloads'), 3);

  store.set('maxConcurrentDownloads', 6);
  assert.equal(store.get('maxConcurrentDownloads'), 6);

  store.update({ turbo: true, turboChunks: 12, maxConcurrentDownloads: 2 });
  assert.equal(store.get('turbo'), true);
  assert.equal(store.get('turboChunks'), 12);
  assert.equal(store.get('maxConcurrentDownloads'), 2);

  // chave desconhecida: no-op (nao grava)
  store.set('chaveInventada', 'x');
  assert.equal(store.get('chaveInventada'), undefined);

  store.reset();
  assert.deepEqual(store.all(), { ...DEFAULT_SETTINGS });
});

test('set aplica clamp e coacao', () => {
  const store = createSettingsStore({ file: path.join(makeTempDir(), 's.json') });
  store.set('maxConcurrentDownloads', 99);
  assert.equal(store.get('maxConcurrentDownloads'), 16);
  store.set('notifications', 0);
  assert.equal(store.get('notifications'), false);
  store.set('notifications', 1);
  assert.equal(store.get('notifications'), true);
});

test('all() nao expoe version', () => {
  const store = createSettingsStore({ file: path.join(makeTempDir(), 's.json') });
  const all = store.all();
  assert.equal(all.version, undefined);
  assert.equal('version' in all, false);
});

test('persistencia round-trip entre instancias', () => {
  const file = path.join(makeTempDir(), 'settings.json');
  const a = createSettingsStore({ file });
  a.update({ defaultDir: 'C:/Downloads', theme: 'dark', maxConcurrentDownloads: 5 });

  const b = createSettingsStore({ file });
  assert.equal(b.get('defaultDir'), 'C:/Downloads');
  assert.equal(b.get('theme'), 'dark');
  assert.equal(b.get('maxConcurrentDownloads'), 5);
  assert.equal(b.get('notifications'), true, 'default intacto');
});

test('arquivo com JSON corrompido: store cai nos defaults sem lancar', () => {
  const file = path.join(makeTempDir(), 'settings.json');
  fs.writeFileSync(file, '{corrompido');
  const store = createSettingsStore({ file });
  assert.equal(store.get('turboChunks'), 8);
});
