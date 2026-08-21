import fs from 'node:fs';
import path from 'node:path';

import { downloadMultipart, downloadSequential } from './downloader.js';
import { planFileDownload } from './planner.js';
import { probeFileDownload } from './probe.js';
import {
  formatBytes,
  getDefaultDownloadsDir,
  normalizeHeaders,
  normalizeUrl,
  parseHeaderArgs,
  sanitizePreservingExtension,
} from './utils.js';

function printHelp() {
  console.log('');
  console.log('fast-downloader');
  console.log('');
  console.log('Uso:');
  console.log('  fast-downloader <url> [opcoes]');
  console.log('');
  console.log('Opcoes:');
  console.log('  --output, -o <dir>      Pasta de saida');
  console.log('  --filename <nome.ext>   Nome final do arquivo');
  console.log('  --turbo                 Ativa download paralelo por partes');
  console.log('  --concurrency <n>       Conexoes paralelas');
  console.log('  --chunks <n>            Alias para --concurrency');
  console.log('  --block-count <n>       Quantidade total de blocos');
  console.log('  --header "K: V"         Header HTTP adicional');
  console.log('  --help                  Mostra esta ajuda');
  console.log('');
}

function parseArgs(argv = []) {
  const args = {
    url: '',
    outputDir: '',
    filename: '',
    turbo: false,
    concurrency: 0,
    blockCount: 0,
    headers: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!args.url && !arg.startsWith('-')) {
      args.url = arg;
      continue;
    }
    if (arg === '--output' || arg === '-o') args.outputDir = argv[++i] || '';
    else if (arg === '--filename') args.filename = argv[++i] || '';
    else if (arg === '--turbo') args.turbo = true;
    else if (arg === '--concurrency' || arg === '--chunks') args.concurrency = Number(argv[++i]) || 0;
    else if (arg === '--block-count') args.blockCount = Number(argv[++i]) || 0;
    else if (arg === '--header') {
      args.headers.push(argv[++i] || '');
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.url) {
    printHelp();
    return args.help ? 0 : 1;
  }

  const target = normalizeUrl(args.url);
  if (!target) {
    console.error('\n[ERRO] URL invalida. Informe uma URL http/https.');
    return 1;
  }

  const headerPairs = parseHeaderArgs(argv);
  const headers = normalizeHeaders(headerPairs);

  let remote;
  try {
    remote = await probeFileDownload(target, { headers });
  } catch (err) {
    console.error(`\n[ERRO] Nao foi possivel sondar o arquivo: ${err.message}`);
    return 1;
  }

  const outputDir = args.outputDir ? path.resolve(args.outputDir) : getDefaultDownloadsDir();
  const filename = sanitizePreservingExtension(args.filename || remote.filename || 'arquivo.bin');
  const output = path.join(outputDir, filename);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\nArquivo detectado: ${filename}`);
  if (remote.totalBytes > 0) console.log(`Tamanho: ${formatBytes(remote.totalBytes)}`);
  if (remote.contentType) console.log(`Content-Type: ${remote.contentType}`);
  console.log(`Capability: ${remote.capability}`);
  console.log(`Saida: ${output}`);

  const plan = args.turbo
    ? planFileDownload({
        totalBytes: remote.totalBytes,
        capability: remote.capability,
        userConcurrency: args.concurrency,
        userBlockCount: args.blockCount,
      })
    : { mode: 'sequential', concurrency: 1, blockCount: 0, rationale: ['turbo desativado'] };

  for (const reason of plan.rationale || []) {
    console.log(`[plan] ${reason}`);
  }

  try {
    if (plan.mode === 'multipart') {
      console.log(`[turbo] Ativado com ${plan.concurrency} conexoes e ${plan.blockCount} blocos.`);
      await downloadMultipart({
        url: remote.finalUrl,
        output,
        headers,
        totalBytes: remote.totalBytes,
        concurrency: plan.concurrency,
        blockCount: plan.blockCount,
        io: console,
      });
    } else {
      if (args.turbo) {
        console.log('[turbo] Servidor nao suporta range suficiente; continuando em modo sequencial.');
      }
      await downloadSequential({
        url: remote.finalUrl,
        output,
        headers,
        totalBytes: remote.totalBytes,
        io: console,
      });
    }
  } catch (err) {
    console.error(`\n[ERRO] Falha no download: ${err.message}`);
    return 1;
  }

  console.log(`Arquivo salvo em: ${output}`);
  return 0;
}
