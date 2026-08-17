/**
 * Instala o mp4decrypt (Bento4) em vendor/mp4decrypt/ (Windows).
 *
 * Uso: npm run mp4decrypt:install
 *
 * mp4decrypt descriptografa MP4 CENC (Widevine/PlayReady) usando chaves
 * KID:KEY obtidas via pywidevine (plano DRM, fase 1).
 *
 * Fontes:
 *  - GitHub releases (axiomatic-systems/Bento4) — builds oficiais
 *  - Fallback: instruções manuais (o usuário pode compilar ou baixar)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor', 'mp4decrypt');
const BIN_NAME = process.platform === 'win32' ? 'mp4decrypt.exe' : 'mp4decrypt';
const BIN_PATH = path.join(VENDOR_DIR, BIN_NAME);
const INSTALLED_MARKER = path.join(VENDOR_DIR, '.installed');

const MP4DECRYPT_URLS = [
  // Binários oficiais do Bento4 (Windows x64) — site oficial (bok.net).
  'https://www.bok.net/Bento4/binaries/Bento4-SDK-1-6-0-641.x86_64-microsoft-win32.zip',
  // Fallback: GitHub releases (podem ser removidos/404).
  'https://github.com/axiomatic-systems/Bento4/releases/download/v1.6.0-640/Bento4-SDK-1.6.0-640.x86_64-microsoft-win32.zip',
];

async function download(url, dest) {
  console.log(`[mp4decrypt] Baixando ${url}`);
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const sevenZip = resolveOnPath('7z') || resolveOnPath('7za');
  if (sevenZip) {
    const r = spawnSync(sevenZip, ['x', '-y', `-o${destDir}`, zipPath], { stdio: 'pipe' });
    if (r.status === 0) return;
  }
  // Fallback: PowerShell Expand-Archive (Windows nativo)
  const ps = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`],
    { stdio: 'pipe', timeout: 120_000 }
  );
  if (ps.status !== 0) {
    throw new Error('Falha ao extrair zip (7z e Expand-Archive indisponíveis).');
  }
}

function findMp4decryptRecursive(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMp4decryptRecursive(p);
      if (found) return found;
    } else if (entry.name === BIN_NAME) {
      return p;
    }
  }
  return null;
}

function resolveOnPath(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [cmd], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const line = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line || null;
}

console.log('\n[mp4decrypt] Verificando instalação...');

if (fs.existsSync(BIN_PATH)) {
  console.log(`[mp4decrypt] Já instalado: ${BIN_PATH}`);
  process.exit(0);
}

const pathBin = resolveOnPath('mp4decrypt');
if (pathBin) {
  console.log(`[mp4decrypt] mp4decrypt já disponível no PATH: ${pathBin}`);
  process.exit(0);
}

const zipPath = path.join(os.tmpdir(), `bento4-${Date.now()}.zip`);
const extractDir = path.join(os.tmpdir(), `bento4-extract-${Date.now()}`);

try {
  let ok = false;
  for (const url of MP4DECRYPT_URLS) {
    try {
      const bytes = await download(url, zipPath);
      console.log(`[mp4decrypt] Baixado (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
      ok = true;
      break;
    } catch (err) {
      console.warn(`[mp4decrypt] Falha na fonte ${url}: ${err.message}`);
    }
  }
  if (!ok) throw new Error('Nenhuma fonte de download respondeu com sucesso.');

  await extractZip(zipPath, extractDir);

  const found = findMp4decryptRecursive(extractDir);
  if (!found) throw new Error('mp4decrypt não encontrado dentro do pacote baixado.');

  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  fs.copyFileSync(found, BIN_PATH);
  fs.writeFileSync(INSTALLED_MARKER, new Date().toISOString());
  console.log(`[mp4decrypt] ✓ Instalado em ${BIN_PATH}`);
} catch (err) {
  console.error(`[mp4decrypt] ✗ Falha na instalação automática: ${err.message}`);
  console.log('');
  console.log('[mp4decrypt] Instalação manual:');
  console.log('  1. Baixe o Bento4 SDK em https://www.bento4.com/downloads/');
  console.log('  2. Extraia e copie mp4decrypt.exe para vendor/mp4decrypt/');
  console.log('  3. Crie o arquivo vendor/mp4decrypt/.installed (vazio)');
  console.log('');
  console.log('  Ou use o gerenciador de pacotes:');
  console.log('    - macOS: brew install bento4');
  console.log('    - Linux: apt install bento4 | dnf install bento4');
  process.exit(1);
} finally {
  try {
    fs.rmSync(zipPath, { force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
