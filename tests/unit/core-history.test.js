import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createHistoryEntry, createHistoryStore } from '../../src/core/history.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-history-test-'));
}

const ENTRY = {
  title: 'Video Exemplo',
  url: 'https://cdn.example/v.mp4',
  provider: 'direct',
  format: 'mp4',
  destination: 'C:/Downloads/video.mp4',
  status: 'completed',
  size: 1024,
  durationMs: 120000,
};

// ---------------------------------------------------------------------------
// createHistoryEntry
// ---------------------------------------------------------------------------

test('createHistoryEntry normaliza campos e gera id/data', () => {
  const e = createHistoryEntry(ENTRY);
  assert.equal(e.title, 'Video Exemplo');
  assert.equal(e.id.startsWith('hist-'), true);
  assert.ok(!Number.isNaN(Date.parse(e.date)), 'date e ISO valida');
});

test('createHistoryEntry exige url', () => {
  assert.throws(() => createHistoryEntry({}), TypeError);
});

// ---------------------------------------------------------------------------
// Store: add/list/remove/clear
// ---------------------------------------------------------------------------

test('add insere no topo (mais recente primeiro) e persiste', () => {
  const file = path.join(makeTempDir(), 'history.json');
  const store = createHistoryStore({ file });
  store.add({ ...ENTRY, title: 'Primeiro' });
  store.add({ ...ENTRY, title: 'Segundo' });

  const list = store.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].title, 'Segundo', 'mais recente primeiro');

  // round-trip: outra instancia le do disco
  const b = createHistoryStore({ file });
  assert.equal(b.list().length, 2);
  assert.equal(b.count(), 2);
});

test('get busca por id; remove e idempotente', () => {
  const store = createHistoryStore({ file: path.join(makeTempDir(), 'h.json') });
  const a = store.add(ENTRY);
  const b = store.add({ ...ENTRY, title: 'Outro' });
  assert.equal(store.get(a.id).title, 'Video Exemplo');

  store.remove(a.id);
  assert.equal(store.get(a.id), null);
  assert.equal(store.count(), 1);

  store.remove('id-inexistente'); // no-op
  assert.equal(store.count(), 1);
  assert.equal(store.get(b.id).title, 'Outro');
});

test('clear limpa tudo e persiste', () => {
  const file = path.join(makeTempDir(), 'h.json');
  const store = createHistoryStore({ file });
  store.add(ENTRY);
  store.add({ ...ENTRY, title: 'X' });
  store.clear();
  assert.equal(store.count(), 0);
  assert.deepEqual(createHistoryStore({ file }).list(), []);
});

test('maxEntries limita o tamanho (mais antigos descartados)', () => {
  const store = createHistoryStore({ file: path.join(makeTempDir(), 'h.json'), maxEntries: 3 });
  for (let i = 0; i < 5; i++) store.add({ ...ENTRY, title: `Item ${i}` });
  const list = store.list();
  assert.equal(list.length, 3);
  assert.equal(list[0].title, 'Item 4');
  assert.equal(list[2].title, 'Item 2');
});

// ---------------------------------------------------------------------------
// Privacidade: retencao em dias (prune no load)
// ---------------------------------------------------------------------------

test('retentionDays remove entradas antigas ao carregar (0 = manter para sempre)', () => {
  const file = path.join(makeTempDir(), 'h.json');
  const store = createHistoryStore({ file });
  const velha = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
  store.add({ ...ENTRY, title: 'Nova' });
  store.add({ ...ENTRY, title: 'Velha', date: velha });
  assert.equal(store.count(), 2);

  const comRetencao = createHistoryStore({ file, retentionDays: 5 });
  const list = comRetencao.list();
  assert.equal(list.length, 1, 'entrada de 10 dias atras removida');
  assert.equal(list[0].title, 'Nova');
  // a remocao foi persistida
  assert.equal(createHistoryStore({ file, retentionDays: 0 }).count(), 1);
});

test('entrada invalida (sem url) e ignorada no load', () => {
  const file = path.join(makeTempDir(), 'h.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [{ title: 'sem url' }, ENTRY] }));
  const store = createHistoryStore({ file });
  assert.equal(store.count(), 1);
  assert.equal(store.list()[0].url, 'https://cdn.example/v.mp4');
});

test('entrada duplicada por url: cada add cria uma nova (nao deduplica)', () => {
  const store = createHistoryStore({ file: path.join(makeTempDir(), 'h.json') });
  const a = store.add(ENTRY);
  const b = store.add(ENTRY);
  assert.notEqual(a.id, b.id);
  assert.equal(store.count(), 2);
});
