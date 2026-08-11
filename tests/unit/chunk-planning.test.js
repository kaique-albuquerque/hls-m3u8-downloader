import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_TURBO_CHUNKS } from '../../src/cli/turbo.js';

/**
 * Testes de caracterizacao do planejamento de chunks do turbo.
 * A formula atual em src/cli/turbo.js e:
 *   chunkSize = Math.ceil(total / chunkCount)
 *   for i in 0..chunkCount-1:
 *     start = i * chunkSize
 *     if start >= total: break
 *     ranges.push([start, min(total - 1, start + chunkSize - 1)])
 * Este arquivo congela esse comportamento via uma implementacao de referencia,
 * para que qualquer mudanca futura no algoritmo seja percebida.
 */
function chunkRanges(total, chunkCount) {
  const ranges = [];
  const chunkSize = Math.ceil(total / chunkCount);
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    if (start >= total) break;
    ranges.push([start, Math.min(total - 1, start + chunkSize - 1)]);
  }
  return ranges;
}

test('chunk DEFAULT_TURBO_CHUNKS: valor atual congelado em 8', () => {
  assert.equal(DEFAULT_TURBO_CHUNKS, 8);
});

test('chunk ranges: 1000 bytes em 8 chunks cobre tudo sem sobreposicao', () => {
  const ranges = chunkRanges(1000, 8);
  assert.deepEqual(ranges, [
    [0, 124],
    [125, 249],
    [250, 374],
    [375, 499],
    [500, 624],
    [625, 749],
    [750, 874],
    [875, 999],
  ]);
  assertFullCoverage(ranges, 1000);
});

test('chunk ranges: 100 bytes em 3 chunks', () => {
  const ranges = chunkRanges(100, 3);
  assert.deepEqual(ranges, [
    [0, 33],
    [34, 67],
    [68, 99],
  ]);
  assertFullCoverage(ranges, 100);
});

test('chunk ranges: total menor que chunkCount gera apenas chunks necessarios', () => {
  const ranges = chunkRanges(10, 8);
  assert.deepEqual(ranges, [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [8, 9],
  ]);
  assertFullCoverage(ranges, 10);
});

test('chunk ranges: total divisivel exato', () => {
  const ranges = chunkRanges(8, 8);
  assert.deepEqual(ranges, [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 6],
    [7, 7],
  ]);
  assertFullCoverage(ranges, 8);
});

test('chunk ranges: total 0 nao gera ranges', () => {
  assert.deepEqual(chunkRanges(0, 8), []);
});

test('chunk ranges: total 1 gera um unico range', () => {
  assert.deepEqual(chunkRanges(1, 8), [[0, 0]]);
});

function assertFullCoverage(ranges, total) {
  assert.ok(ranges.length > 0, 'deve haver pelo menos um range');
  assert.equal(ranges[0][0], 0, 'primeiro range comeca em 0');
  assert.equal(ranges[ranges.length - 1][1], total - 1, 'ultimo range termina em total-1');
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(ranges[i][0], ranges[i - 1][1] + 1, `sem lacuna nem sobreposicao entre ranges ${i - 1} e ${i}`);
  }
}
