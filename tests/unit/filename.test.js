import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeFilename, ensureMp4 } from '../../src/utils.js';

/**
 * Testes de caracterizacao do fluxo de nome de arquivo de saida:
 * sanitizeFilename() + ensureMp4() usados em conjunto pelo download.
 */

test('filename: fluxo completo gera nome .mp4 seguro', () => {
  // : vira _ e o espaco que o seguia e preservado; / vira _
  const name = ensureMp4(sanitizeFilename('  Vídeo: Parte 1/2  '));
  assert.equal(name, 'Vídeo_ Parte 1_2.mp4');
});

test('filename: extensao existente nao e duplicada', () => {
  assert.equal(ensureMp4(sanitizeFilename('video.mp4')), 'video.mp4');
  assert.equal(ensureMp4(sanitizeFilename('VIDEO.MP4')), 'VIDEO.MP4');
});

test('filename: entrada vazia vira video.mp4', () => {
  assert.equal(ensureMp4(sanitizeFilename('')), 'video.mp4');
});

test('filename: nome reservado sanitizado recebe prefixo e .mp4', () => {
  assert.equal(ensureMp4(sanitizeFilename('CON')), '_CON.mp4');
  assert.equal(ensureMp4(sanitizeFilename('con')), '_con.mp4');
  assert.equal(ensureMp4(sanitizeFilename('COM3')), '_COM3.mp4');
});

test('filename: nomes com barras de caminho nao escapam da pasta', () => {
  // barras viram _ e os pontos iniciais sao removidos (leading-dot cleanup)
  assert.equal(sanitizeFilename('..\\..\\etc\\passwd'), '_.._etc_passwd');
  assert.equal(sanitizeFilename('a/b/c'), 'a_b_c');
});

test('filename: nome final nao tem pontos nem espacos', () => {
  const n = sanitizeFilename('minha gravação...   ');
  assert.ok(!n.endsWith('.') && !n.endsWith(' '));
  assert.equal(n, 'minha gravação');
});

test('filename: apenas caracteres invalidos vira underscores (nao cai para video)', () => {
  // * : ? viram _; o resultado nao e vazio, entao nao ha fallback para "video"
  assert.equal(ensureMp4(sanitizeFilename('***:::???')), '_________.mp4');
});
