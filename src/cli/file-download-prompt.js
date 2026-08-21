import fs from 'node:fs';
import path from 'node:path';

import { getDefaultDownloadsDir, normalizeUrl } from '../utils.js';
import {
  DEFAULT_TURBO_CHUNKS,
  FILE_DOWNLOAD_PRESETS,
  MAX_FILE_TURBO_CHUNKS,
  normalizeChunkCount,
  parsePositiveInt,
  sanitizePreservingExtension,
} from './file-download-shared.js';

export function parseFileFlags(rest = []) {
  const flags = {
    outputDir: '',
    filename: '',
    turbo: false,
    concurrency: 0,
    blockCount: 0,
    preset: 'auto',
    noResume: false,
    headers: {},
  };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--output' || arg === '-o') flags.outputDir = rest[++i] || '';
    else if (arg === '--filename') flags.filename = rest[++i] || '';
    else if (arg === '--turbo') flags.turbo = true;
    else if (arg === '--concurrency' || arg === '--chunks') flags.concurrency = Number(rest[++i]) || 0;
    else if (arg === '--block-count') flags.blockCount = Number(rest[++i]) || 0;
    else if (arg === '--preset') flags.preset = String(rest[++i] || 'auto').trim().toLowerCase();
    else if (arg === '--no-resume') flags.noResume = true;
  }
  return flags;
}

export async function promptFileDownloadOptions(ask, io = console, initialFlags = {}) {
  const url = normalizeUrl((await ask('\nLink do arquivo: ')).trim());
  if (!url) {
    io.error('\n[ERRO] Nenhum link informado.');
    return null;
  }

  io.log('\nPreset de download:');
  io.log('  1. Auto (equilibrado)');
  io.log('  2. Conservador');
  io.log('  3. Agressivo');
  io.log('  4. Personalizado');
  io.log('  5. Sem turbo (sequencial)');

  const presetChoice = (await ask('\nEscolha a opcao [1]: ')).trim() || '1';
  let turbo = true;
  let preset = 'auto';
  let concurrency = DEFAULT_TURBO_CHUNKS;
  let blockCount = 0;

  if (presetChoice === '2') {
    preset = 'conservative';
    concurrency = FILE_DOWNLOAD_PRESETS.conservative.concurrency;
  } else if (presetChoice === '3') {
    preset = 'aggressive';
    concurrency = FILE_DOWNLOAD_PRESETS.aggressive.concurrency;
  } else if (presetChoice === '4') {
    preset = 'custom';
    io.log('\nConexoes paralelas:');
    io.log('  1. 4 conexoes');
    io.log('  2. 8 conexoes');
    io.log('  3. 16 conexoes');
    io.log('  4. 32 conexoes');
    io.log('  5. 64 conexoes');
    io.log('  6. 128 conexoes');
    io.log('  7. Personalizado');
    const concurrencyChoice = (await ask('\nEscolha a opcao [2]: ')).trim() || '2';
    if (concurrencyChoice === '1') concurrency = 4;
    else if (concurrencyChoice === '2') concurrency = 8;
    else if (concurrencyChoice === '3') concurrency = 16;
    else if (concurrencyChoice === '4') concurrency = 32;
    else if (concurrencyChoice === '5') concurrency = 64;
    else if (concurrencyChoice === '6') concurrency = 128;
    else {
      const raw = (await ask(`Quantas conexoes voce quer usar? (max ${MAX_FILE_TURBO_CHUNKS}) `)).trim();
      concurrency = normalizeChunkCount(raw);
    }
    io.log('\nBlocos totais:');
    io.log('  1. Automatico');
    io.log('  2. 128 blocos');
    io.log('  3. 256 blocos');
    io.log('  4. 512 blocos');
    io.log('  5. 1024 blocos');
    io.log('  6. 2048 blocos');
    io.log('  7. Personalizado');
    const blockChoice = (await ask('\nEscolha a opcao [1]: ')).trim() || '1';
    if (blockChoice === '2') blockCount = 128;
    else if (blockChoice === '3') blockCount = 256;
    else if (blockChoice === '4') blockCount = 512;
    else if (blockChoice === '5') blockCount = 1024;
    else if (blockChoice === '6') blockCount = 2048;
    else if (blockChoice === '7') {
      const rawBlockCount = (await ask('Quantos blocos totais voce quer usar? ')).trim();
      blockCount = parsePositiveInt(rawBlockCount);
    }
  } else if (presetChoice === '5') {
    turbo = false;
    concurrency = 1;
  }

  const defaultDir = getDefaultDownloadsDir();
  const outputDir = ((await ask(`Pasta de saida (Enter = ${defaultDir}): `)).trim()) || defaultDir;
  const filename = (await ask('Nome do arquivo (Enter = detectar automaticamente): ')).trim();

  return {
    url,
    flags: {
      ...initialFlags,
      turbo,
      preset,
      concurrency,
      blockCount,
      outputDir,
      filename,
    },
  };
}

export async function resolveExistingFileForGeneric(ask, io, output) {
  while (fs.existsSync(output)) {
    io.log(`\n[AVISO] O arquivo ja existe: ${output}`);
    const choice = (await ask('(S)obrescrever, (N)ovo nome, (C)cancelar? ')).trim().toUpperCase();
    if (choice.startsWith('S')) return { action: 'overwrite', output };
    if (choice.startsWith('N')) {
      const ext = path.extname(output);
      const newName = sanitizePreservingExtension((await ask('Novo nome do arquivo: ')).trim() || `arquivo${ext}`);
      output = path.join(path.dirname(output), newName);
      continue;
    }
    return { action: 'cancel', output };
  }
  return { action: 'ok', output };
}
