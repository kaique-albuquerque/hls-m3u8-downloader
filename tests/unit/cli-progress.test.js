import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProgressReporter } from '../../src/cli/progress.js';

test('cli progress: finish(false) nao anuncia sucesso', () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };

  try {
    const reporter = createProgressReporter({}, { label: 'Baixando' });
    reporter.finish(false);
  } finally {
    process.stdout.write = originalWrite;
  }

  const text = writes.join('');
  assert.match(text, /Baixando falhou\./);
  assert.doesNotMatch(text, /Baixando concluido\./);
});

test('cli progress: finish() continua anunciando sucesso por padrao', () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };

  try {
    const reporter = createProgressReporter({}, { label: 'Baixando' });
    reporter.finish();
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(writes.join(''), /Baixando concluido\./);
});
