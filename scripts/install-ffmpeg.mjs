/**
 * Instala o FFmpeg localmente em vendor/ffmpeg/ (Windows).
 *
 * Roda automaticamente no `npm install` (via script "postinstall") ou
 * manualmente com: npm run ffmpeg:install
 *
 * - Se o binário local já existir, pula (não baixa de novo).
 * - Usa o build "essentials" do gyan.dev (ffmpeg + ffprobe).
 * - Extrai com o PowerShell (Expand-Archive) — sem dependências npm.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor', 'ffmpeg');
const BIN_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const BIN_PATH = path.join(VENDOR_DIR, BIN_NAME);

const URL =
  process.platform === 'win32'
    ? 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    : null;

console.log('\n[ffmpeg] Verificando instalação local do FFmpeg...');

if (fs.existsSync(BIN_PATH)) {
  const ver = runLocal(['-version']);
  console.log(`[ffmpeg] Já instalado: ${BIN_PATH}`);
  console.log(`[ffmpeg] Versão: ${(ver || '?').split('\n')[0] || '?'}`);
  process.exit(0);
}

if (!URL) {
  console.log('[ffmpeg] Instalação automática suportada apenas no Windows.');
  console.log('[ffmpeg] Instale o FFmpeg manualmente e adicione ao PATH: https://ffmpeg.org/download.html');
  process.exit(1);
}

console.log('[ffmpeg] Baixando FFmpeg (build essentials do gyan.dev)...');

const zipPath = path.join(os.tmpdir(), `ffmpeg-${Date.now()}.zip`);
const extractDir = path.join(os.tmpdir(), `ffmpeg-extract-${Date.now()}`);

try {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(zipPath, buf);
  console.log(`[ffmpeg] Baixado: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  fs.mkdirSync(extractDir, { recursive: true });
  console.log('[ffmpeg] Extraindo...');
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 180000 }
  );
  if (r.status !== 0) throw new Error(`Falha ao extrair: ${r.stderr || r.stdout || 'erro desconhecido'}`);

  // Localiza o ffmpeg.exe dentro da estrutura ffmpeg-*-essentials_build/bin/
  const found = findFile(extractDir, BIN_NAME);
  if (!found) throw new Error(`binário ${BIN_NAME} não encontrado no arquivo baixado`);

  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  fs.copyFileSync(found, BIN_PATH);
  console.log(`[ffmpeg] Instalado em: ${BIN_PATH}`);

  const ver = runLocal(['-version']);
  console.log(`[ffmpeg] Versão: ${(ver || '?').split('\n')[0] || '?'}`);
  console.log('[ffmpeg] ✅ FFmpeg pronto!');
} catch (err) {
  console.error(`[ffmpeg] ❌ Falha ao instalar: ${err.message}`);
  console.error('[ffmpeg] Instale manualmente em https://ffmpeg.org/download.html e adicione ao PATH.');
  process.exitCode = 1;
} finally {
  try { fs.rmSync(zipPath, { force: true }); } catch { /* ignora */ }
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignora */ }
}

/** Procura um arquivo recursivamente dentro de um diretório. */
function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

/** Roda o binário local e retorna a saída. */
function runLocal(args) {
  try {
    const r = spawnSync(BIN_PATH, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    return r.status === 0 ? r.stdout : r.stderr;
  } catch {
    return '';
  }
}
