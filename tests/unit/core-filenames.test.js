import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
  MAX_FILENAME_BYTES,
  sanitizeFilename,
  truncateToBytes,
  ensureExtension,
  isPathTraversalSafe,
  baseNameOnly,
  resolveSafeFilename,
  nextAvailableName,
} from '../../src/core/filenames.js';

test('core-filenames: caracteres invalidos do Windows viram underscore', () => {
  const out = sanitizeFilename('a<b>c:d"e/f\\g|h?i*j');
  assert.equal(out, 'a_b_c_d_e_f_g_h_i_j');
});

test('core-filenames: nomes reservados recebem prefixo', () => {
  assert.equal(sanitizeFilename('CON'), '_CON');
  assert.equal(sanitizeFilename('con'), '_con');
  assert.equal(sanitizeFilename('lpt1'), '_lpt1');
  assert.equal(sanitizeFilename('com9'), '_com9');
  assert.equal(sanitizeFilename('console'), 'console', 'nao reservado nao recebe prefixo');
});

test('core-filenames: unicode preservado', () => {
  assert.equal(sanitizeFilename('vídeo aula – 日本語'), 'vídeo aula – 日本語');
});

test('core-filenames: espacos/pontos nas bordas removidos e vazio vira video', () => {
  assert.equal(sanitizeFilename('  nome.mp4  '), 'nome.mp4');
  assert.equal(sanitizeFilename('...'), 'video');
  assert.equal(sanitizeFilename('   '), 'video');
  assert.equal(sanitizeFilename(''), 'video');
});

test('core-filenames: truncateToBytes respeita limite sem cortar multibyte', () => {
  const longAscii = 'a'.repeat(300);
  const truncated = truncateToBytes(longAscii);
  assert.ok(Buffer.byteLength(truncated, 'utf8') <= MAX_FILENAME_BYTES);
  assert.equal(truncated.length, 255);

  // Unicode: nao pode cortar no meio de um caractere de 2+ bytes.
  const unicode = 'á'.repeat(200);
  const t = truncateToBytes(unicode);
  assert.ok(Buffer.byteLength(t, 'utf8') <= MAX_FILENAME_BYTES);
  assert.equal(Buffer.byteLength(t, 'utf8') % 2, 0, 'nao corta no meio de um char de 2 bytes');
});

test('core-filenames: truncateToBytes mantem nome curto intacto', () => {
  assert.equal(truncateToBytes('video.mp4'), 'video.mp4');
});

test('core-filenames: ensureExtension adiciona e nao duplica', () => {
  assert.equal(ensureExtension('video'), 'video.mp4');
  assert.equal(ensureExtension('video.mp4'), 'video.mp4');
  assert.equal(ensureExtension('video.MP4'), 'video.MP4');
  assert.equal(ensureExtension('video', '.mkv'), 'video.mkv');
});

test('core-filenames: isPathTraversalSafe bloqueia .. e NUL', () => {
  assert.equal(isPathTraversalSafe('aula.mp4'), true);
  assert.equal(isPathTraversalSafe('a..b.mp4'), true, 'a..b nao e traversal');
  assert.equal(isPathTraversalSafe('../aula.mp4'), false);
  assert.equal(isPathTraversalSafe('aula/../../etc/passwd'), false);
  assert.equal(isPathTraversalSafe('aula\\..\\..\\etc'), false);
  assert.equal(isPathTraversalSafe('a\0b.mp4'), false);
});

test('core-filenames: baseNameOnly remove diretorios (bloqueia traversal)', () => {
  assert.equal(baseNameOnly('aula.mp4'), 'aula.mp4');
  assert.equal(baseNameOnly('../../etc/passwd'), 'passwd');
  assert.equal(baseNameOnly('C:\\Users\\x\\Downloads\\aula.mp4'), 'aula.mp4');
  assert.equal(baseNameOnly('..'), '..');
});

test('core-filenames: resolveSafeFilename nunca escapa do diretorio', () => {
  const dir = path.join('C:', 'saida');
  assert.equal(resolveSafeFilename('../../etc/passwd', { dir }), path.join(dir, 'passwd.mp4'));
  assert.equal(resolveSafeFilename('..\\..\\etc\\shadow', { dir }), path.join(dir, 'shadow.mp4'));
  assert.equal(resolveSafeFilename('aula', { dir }), path.join(dir, 'aula.mp4'));
});

test('core-filenames: resolveSafeFilename trunca e garante extensao', () => {
  const name = 'a'.repeat(300);
  const out = resolveSafeFilename(name);
  assert.ok(Buffer.byteLength(out, 'utf8') <= MAX_FILENAME_BYTES);
  assert.ok(out.endsWith('.mp4'));
});

test('core-filenames: resolveSafeFilename reservado ganha prefixo', () => {
  assert.equal(resolveSafeFilename('CON'), '_CON.mp4');
});

test('core-filenames: nextAvailableName gera Video (1).mp4, Video (2).mp4...', () => {
  const files = new Set(['C:\\saida\\Video.mp4']);
  const exists = (p) => files.has(p);
  assert.equal(nextAvailableName('C:\\saida\\Video.mp4', exists), 'C:\\saida\\Video (1).mp4');
  files.add('C:\\saida\\Video (1).mp4');
  assert.equal(nextAvailableName('C:\\saida\\Video.mp4', exists), 'C:\\saida\\Video (2).mp4');
  files.add('C:\\saida\\Video (2).mp4');
  assert.equal(nextAvailableName('C:\\saida\\Video.mp4', exists), 'C:\\saida\\Video (3).mp4');
});

test('core-filenames: nextAvailableName sem colisao retorna o proprio caminho', () => {
  const exists = () => false;
  assert.equal(nextAvailableName('C:\\saida\\Video.mp4', exists), 'C:\\saida\\Video.mp4');
});

test('core-filenames: nextAvailableName default usa fs (arquivo real)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamgrab-fn-'));
  try {
    const target = path.join(dir, 'aula.mp4');
    fs.writeFileSync(target, 'x');
    const next = nextAvailableName(target);
    assert.equal(next, path.join(dir, 'aula (1).mp4'));
    assert.equal(fs.existsSync(next), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
