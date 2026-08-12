/**
 * P10 — Gera checksums SHA-256 dos artefatos de release (scripts/checksums.mjs)
 *
 * Varre dist/ por instaladores (StreamGrab-Setup-*.exe) e escreve
 * dist/SHA256SUMS.txt (formato: "<hash>  <nome-do-arquivo>").
 *
 * Uso: node scripts/checksums.mjs
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const OUTPUT = path.join(DIST_DIR, 'SHA256SUMS.txt');

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function main() {
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error(`Diretório ${DIST_DIR} não existe — rode 'npm run dist' primeiro.`);
  }
  const artifacts = fs
    .readdirSync(DIST_DIR)
    .filter((name) => /\.(exe|blockmap|yml)$/i.test(name))
    .sort();

  if (!artifacts.length) {
    throw new Error(`Nenhum artefato em ${DIST_DIR} (esperava *.exe).`);
  }

  const lines = artifacts.map((name) => `${sha256(path.join(DIST_DIR, name))}  ${name}`);
  fs.writeFileSync(OUTPUT, `${lines.join('\n')}\n`);
  console.log(`\n[checksums] ${OUTPUT}`);
  for (const line of lines) console.log(`  ${line}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`\n[checksums] ERRO: ${err.message}`);
    process.exit(1);
  }
}
