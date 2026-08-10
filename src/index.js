import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrompter } from './input.js';
import { runCliSession } from './cli-flow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function main() {
  const argv = process.argv.slice(2);
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
  process.exit(result?.code ?? 0);
}

main().catch((err) => {
  console.error('\n[ERRO inesperado]', err && err.stack ? err.stack : err);
  process.exit(1);
});
