// P6.1 — core/resume: DownloadState (escrita atomica) + validators.
//
// Cobre (plano §13):
//  - createState/loadState round-trip (escrita atomica via tmp+rename)
//  - arquivo ausente -> null; JSON corrompido -> null; versao errada -> null
//  - validateState: ok; SIZE_CHANGED; ETAG_CHANGED; LAST_MODIFIED_CHANGED;
//    NO_VALIDATOR (ETag/Last-Modified registrado e probe sem validator)
//  - completedBytes; clearState remove sidecar e tmp

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defaultStatePath,
  createState,
  loadState,
  saveState,
  clearState,
  validateState,
  completedBytes,
  RESUME_STATE_VERSION,
} from '../../src/core/resume.js';

function tmpState(prefix = 'vd-resume-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'out.mp4.resume.json');
}

test('defaultStatePath: sidecar <destino>.resume.json', () => {
  assert.equal(defaultStatePath('C:/videos/out.mp4'), 'C:/videos/out.mp4.resume.json');
});

test('createState: shape completo com chunks normalizados', () => {
  const state = createState({
    url: 'http://x/f.mp4',
    destination: 'out.mp4',
    totalSize: 1000,
    etag: '"abc"',
    lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT',
    chunks: [{ start: 0, end: 499, downloaded: 0, completed: false }],
  });
  assert.equal(state.version, RESUME_STATE_VERSION);
  assert.equal(state.url, 'http://x/f.mp4');
  assert.equal(state.totalSize, 1000);
  assert.equal(state.etag, '"abc"');
  assert.equal(state.chunks.length, 1);
  assert.equal(state.chunks[0].end, 499);
  assert.ok(state.createdAt);
});

test('saveState/loadState round-trip: escrita atomica + leitura fiel', async () => {
  const sp = tmpState();
  const state = createState({
    url: 'http://x/f.mp4',
    destination: 'out.mp4',
    totalSize: 800,
    chunks: [
      { start: 0, end: 399, downloaded: 400, completed: true },
      { start: 400, end: 799, downloaded: 0, completed: false },
    ],
  });
  const ok = await saveState(sp, state);
  assert.equal(ok, true);
  assert.equal(fs.existsSync(`${sp}.tmp`), false, 'tmp nao deve sobrar apos o rename');

  const loaded = loadState(sp);
  assert.equal(loaded.url, 'http://x/f.mp4');
  assert.equal(loaded.totalSize, 800);
  assert.equal(loaded.chunks[0].completed, true);
  assert.equal(loaded.chunks[1].completed, false);
  assert.ok(loaded.updatedAt, 'saveState deve atualizar updatedAt');
});

test('loadState: arquivo ausente -> null', () => {
  assert.equal(loadState(tmpState()), null);
});

test('loadState: JSON corrompido -> null', async () => {
  const sp = tmpState();
  fs.writeFileSync(sp, '{ not valid json !!', 'utf8');
  assert.equal(loadState(sp), null);
});

test('loadState: versao desconhecida -> null', async () => {
  const sp = tmpState();
  fs.writeFileSync(sp, JSON.stringify({ version: 999, chunks: [], totalSize: 1 }), 'utf8');
  assert.equal(loadState(sp), null);
});

test('validateState: validators coincidem -> ok', () => {
  const state = createState({ url: 'u', destination: 'd', totalSize: 100, etag: '"a"', lastModified: 'LM1' });
  assert.deepEqual(validateState(state, { total: 100, etag: '"a"', lastModified: 'LM1' }), { ok: true });
  // sem validators em ambos -> ok (apenas tamanho)
  const bare = createState({ url: 'u', destination: 'd', totalSize: 50 });
  assert.deepEqual(validateState(bare, { total: 50 }), { ok: true });
});

test('validateState: tamanho diferente -> SIZE_CHANGED', () => {
  const state = createState({ url: 'u', destination: 'd', totalSize: 100 });
  const v = validateState(state, { total: 120 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'SIZE_CHANGED');
});

test('validateState: ETag diferente -> ETAG_CHANGED', () => {
  const state = createState({ url: 'u', destination: 'd', totalSize: 100, etag: '"v1"' });
  const v = validateState(state, { total: 100, etag: '"v2"' });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'ETAG_CHANGED');
});

test('validateState: Last-Modified diferente -> LAST_MODIFIED_CHANGED', () => {
  const state = createState({ url: 'u', destination: 'd', totalSize: 100, lastModified: 'LM1' });
  const v = validateState(state, { total: 100, lastModified: 'LM2' });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'LAST_MODIFIED_CHANGED');
});

test('validateState: ETag registrado e probe sem -> NO_VALIDATOR (nunca concatena sem confirmacao)', () => {
  const state = createState({ url: 'u', destination: 'd', totalSize: 100, etag: '"v1"' });
  const v = validateState(state, { total: 100 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'NO_VALIDATOR');
});

test('completedBytes: soma apenas chunks completed', () => {
  const state = createState({
    url: 'u',
    destination: 'd',
    totalSize: 1000,
    chunks: [
      { start: 0, end: 249, downloaded: 250, completed: true },
      { start: 250, end: 499, downloaded: 100, completed: false },
      { start: 500, end: 749, downloaded: 250, completed: true },
      { start: 750, end: 999, downloaded: 0, completed: false },
    ],
  });
  assert.equal(completedBytes(state), 500);
});

test('clearState: remove sidecar (e tmp), ignora ausencia', async () => {
  const sp = tmpState();
  await saveState(sp, createState({ url: 'u', destination: 'd', totalSize: 1 }));
  fs.writeFileSync(`${sp}.tmp`, 'x', 'utf8');
  await clearState(sp);
  assert.equal(fs.existsSync(sp), false);
  assert.equal(fs.existsSync(`${sp}.tmp`), false);
  await clearState(sp); // nao deve lancar
});
