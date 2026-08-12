import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { tmpPathFor, atomicWriteFileSync, readJsonSafe, createJsonStore } from '../../src/core/storage.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-storage-test-'));
}

// ---------------------------------------------------------------------------
// Escrita atomica: .tmp + rename
// ---------------------------------------------------------------------------

test('tmpPathFor retorna o caminho .tmp', () => {
  assert.equal(tmpPathFor('C:/data/x.json'), 'C:/data/x.json.tmp');
  assert.equal(tmpPathFor('/tmp/a.json'), '/tmp/a.json.tmp');
});

test('atomicWriteFileSync escreve e renomeia (sem .tmp sobrando)', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'sub', 'data.json');
  atomicWriteFileSync(file, { a: 1 });
  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'nao deve sobrar .tmp');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
});

test('atomicWriteFileSync cria diretorios intermediarios', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'a', 'b', 'c.json');
  atomicWriteFileSync(file, { ok: true });
  assert.equal(fs.existsSync(file), true);
});

test('readJsonSafe retorna null para arquivo inexistente', () => {
  assert.equal(readJsonSafe(path.join(makeTempDir(), 'nao-existe.json')), null);
});

test('readJsonSafe retorna null para JSON corrompido (crash simulado)', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'corrompido.json');
  fs.writeFileSync(file, '{"version": 1, "entries": [quebrado');
  assert.equal(readJsonSafe(file), null);
});

test('readJsonSafe retorna o objeto para JSON valido', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'ok.json');
  atomicWriteFileSync(file, { version: 1, x: 2 });
  assert.deepEqual(readJsonSafe(file), { version: 1, x: 2 });
});

// ---------------------------------------------------------------------------
// createJsonStore: versionamento, merge tolerante, downgrade seguro
// ---------------------------------------------------------------------------

test('store novo persiste defaults versionados', () => {
  const file = path.join(makeTempDir(), 'store.json');
  const store = createJsonStore({ file, version: 1, defaults: { entries: [], nome: 'x' } });
  assert.deepEqual(store.get(), { version: 1, entries: [], nome: 'x' });
  // ainda nao persistiu (load implicito); save() grava
  store.save({ nome: 'y' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, entries: [], nome: 'y' });
});

test('save merge com o atual e normaliza (version sempre = schema)', () => {
  const file = path.join(makeTempDir(), 'store.json');
  const store = createJsonStore({ file, version: 2, defaults: { a: 0, b: 1 } });
  store.save({ a: 5 });
  store.save({ b: 9 });
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(raw, { version: 2, a: 5, b: 9 });
});

test('arquivo existente com campos conhecidos e preservado no load', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'store.json');
  atomicWriteFileSync(file, { version: 1, a: 42, b: 'legado' });
  const store = createJsonStore({ file, version: 1, defaults: { a: 0, b: '', c: false } });
  assert.equal(store.get().a, 42);
  assert.equal(store.get().b, 'legado');
  assert.equal(store.get().c, false, 'default aplicado para chave ausente');
});

test('arquivo de versao futura: campos desconhecidos sao ignorados (downgrade seguro)', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'store.json');
  // escrito por uma versao FUTURA (version 3) com campos novos
  atomicWriteFileSync(file, { version: 3, a: 1, campoFuturo: 'segredo' });
  const store = createJsonStore({ file, version: 1, defaults: { a: 0 } });
  assert.equal(store.get().a, 1, 'campo conhecido preservado');
  assert.equal(store.get().campoFuturo, undefined, 'campo de versao futura ignorado');
  assert.equal(store.get().version, 1, 'version normalizada para o schema atual');
});

test('arquivo de versao anterior: campos desconhecidos sao preservados', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'store.json');
  atomicWriteFileSync(file, { version: 1, a: 1, campoAntigo: 'mantido' });
  const store = createJsonStore({ file, version: 2, defaults: { a: 0 } });
  assert.equal(store.get().a, 1);
  assert.equal(store.get().campoAntigo, 'mantido', 'campos de versao anterior preservados');
});

test('arquivo corrompido: load cai nos defaults (nunca lanca)', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'store.json');
  fs.writeFileSync(file, 'not-json{{');
  const store = createJsonStore({ file, version: 1, defaults: { a: 'padrao' } });
  assert.deepEqual(store.get(), { version: 1, a: 'padrao' });
});

test('set() persistido pode ser lido por outra instancia (round-trip)', () => {
  const file = path.join(makeTempDir(), 'store.json');
  const a = createJsonStore({ file, version: 1, defaults: { v: 0 } });
  a.set({ v: 7 });
  const b = createJsonStore({ file, version: 1, defaults: { v: 0 } });
  assert.equal(b.get().v, 7);
});
