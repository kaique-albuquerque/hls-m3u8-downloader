import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrompter } from './input.js';
import { runCliSession } from './cli-flow.js';
import {
  parseCliCommand,
  printSubcommandHelp,
  parseAnalyzeFlags,
  parseDownloadFlags,
  runAnalyzeCommand,
  runDownloadCommand,
} from './cli/commands.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * P9 — Dispatch dos subcomandos (aditivo; o fluxo interativo continua intacto).
 *
 *   streamgrab <url>                     interativo (compatibilidade)
 *   streamgrab analyze <url> [--json]    análise não-interativa
 *   streamgrab download <url> [opcoes]   download não-interativo
 *   streamgrab help                      ajuda dos subcomandos
 *
 * Exit codes: 0 = ok, 1 = erro, 130 = cancelado.
 */
export async function main(argv = process.argv.slice(2)) {
  const { command, url, rest } = parseCliCommand(argv);

  if (command === 'help') {
    printSubcommandHelp(console);
    return 0;
  }

  if (command === 'analyze') {
    if (rest.includes('--help') || rest.includes('-h') || url.startsWith('-')) {
      printSubcommandHelp(console);
      return 0;
    }
    const flags = parseAnalyzeFlags(rest);
    const result = await runAnalyzeCommand({ url, projectRoot: PROJECT_ROOT, io: console, flags });
    return result?.code ?? 1;
  }

  if (command === 'download') {
    if (rest.includes('--help') || rest.includes('-h') || url.startsWith('-')) {
      printSubcommandHelp(console);
      return 0;
    }
    const flags = parseDownloadFlags(rest);
    // Garantir que usa o novo método com fallbacks
    const result = await runDownloadCommand({ url, projectRoot: PROJECT_ROOT, io: console, options: flags });
    return result?.code ?? 1;
  }

  // Fluxo interativo (compatibilidade preservada — mesma chamada do Electron).
  const prompter = createPrompter();
  const result = await runCliSession({
    argv,
    projectRoot: PROJECT_ROOT,
    ask: (question) => prompter.ask(question),
  });

  try {
    prompter.close();
  } catch {
    /* ignora */
  }
  return result?.code ?? 0;
}

// Auto-executa quando invocado diretamente (node src/index.js). O bin/streamgrab.mjs
// chama main() explicitamente, então o dispatch nunca roda duas vezes.
const isEntry = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      console.error('\n[ERRO inesperado]', err && err.stack ? err.stack : err);
      process.exit(1);
    });
}

/**
 * Função para detectar se o vídeo é protegido por DRM
 */
export async function detectDRM(url) {
  try {
    const drmDownloader = new DRMDownloader();
    return await drmDownloader.detectDRM(url);
  } catch (error) {
    console.warn('Falha ao detectar DRM:', error.message);
    return { type: null };
  }
}

/**
 * Função para download de vídeo com fallback
 */
export async function downloadVideo(url, options) {
  try {
    const drmInfo = await detectDRM(url);
    
    if (drmInfo.type) {
      const drmDownloader = new DRMDownloader(options);
      return await drmDownloader.download(url, options);
    }
    
    // Se não for DRM, usa download normal
    return await runDownloadCommand({ url, projectRoot: PROJECT_ROOT, io: console, options });
  } catch (error) {
    console.error('Erro no download:', error);
    throw error;
  }
}

export default main;
