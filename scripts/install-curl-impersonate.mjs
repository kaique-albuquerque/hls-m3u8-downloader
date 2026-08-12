import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { installCurlImpersonate } from '../src/curlimp-install.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

try {
  const result = await installCurlImpersonate({ projectRoot: PROJECT_ROOT, io: console });
  if (!result.ok && result.reason === 'unsupported-platform') {
    console.log('[curl-impersonate] Instalação automática suportada apenas no Windows.');
  }
} catch (err) {
  console.error(`[curl-impersonate] Falha ao instalar: ${err.message}`);
  process.exitCode = 1;
}

