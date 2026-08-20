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
import { parseFileFlags, promptFileDownloadOptions, runFileDownloadCommand } from './cli/file-download.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

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
    const result = await runDownloadCommand({ url, projectRoot: PROJECT_ROOT, io: console, options: flags });
    return result?.code ?? 1;
  }

  if (command === 'file') {
    if (rest.includes('--help') || rest.includes('-h') || url.startsWith('-')) {
      printSubcommandHelp(console);
      return 0;
    }
    const flags = parseFileFlags(rest);
    let finalUrl = url;
    let finalFlags = flags;
    let filePrompter = null;
    if (!finalUrl) {
      filePrompter = createPrompter();
      const prompted = await promptFileDownloadOptions((question) => filePrompter.ask(question), console, flags);
      if (!prompted) {
        try {
          filePrompter.close();
        } catch {
          // ignore
        }
        return 1;
      }
      finalUrl = prompted.url;
      finalFlags = { ...prompted.flags, ask: (question) => filePrompter.ask(question) };
    }
    const result = await runFileDownloadCommand({ url: finalUrl, io: console, flags: finalFlags });
    try {
      filePrompter?.close();
    } catch {
      // ignore
    }
    return result?.code ?? 1;
  }

  const prompter = createPrompter();
  const result = await runCliSession({
    argv,
    projectRoot: PROJECT_ROOT,
    ask: (question) => prompter.ask(question),
  });

  try {
    prompter.close();
  } catch {
    // ignore
  }
  return result?.code ?? 0;
}

const isEntry = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      console.error('\n[ERRO inesperado]', err && err.stack ? err.stack : err);
      process.exit(1);
    });
}

export default main;
