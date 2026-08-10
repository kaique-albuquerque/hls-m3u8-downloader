/**
 * Instala o FFmpeg localmente em vendor/ffmpeg/ (Windows).
 *
 * Roda automaticamente no `npm install` (via script "postinstall") ou
 * manualmente com: npm run ffmpeg:install
 *
 * - Se o binário local já existir, pula (não baixa de novo).
 * - Usa o build "essentials" do gyan.dev (ffmpeg + ffprobe).
 * - Se 7-Zip não existir no PATH, instala uma cópia local temporária.
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
const INSTALLED_MARKER = path.join(VENDOR_DIR, '.installed');
const INSTALLED_VERSION = path.join(VENDOR_DIR, '.version');

const FFmpeg_URLS =
  process.platform === 'win32'
    ? [
      {
        label: 'BtbN GitHub Releases',
        url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip',
        archiveType: 'zip',
      },
      {
        label: 'gyan.dev',
        url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.7z',
        archiveType: '7z',
      },
    ]
    : [];
const SEVEN_ZIP_URL =
  process.platform === 'win32'
    ? 'https://www.7-zip.org/a/7z2602-x64.exe'
    : null;

console.log('\n[ffmpeg] Verificando instalação local do FFmpeg...');
const installStartedAt = Date.now();

if (isLocalFfmpegReady()) {
  const ver = runLocal(['-version']);
  console.log(`[ffmpeg] Já instalado: ${BIN_PATH}`);
  console.log(`[ffmpeg] Versão: ${formatVersion(ver)}`);
  process.exit(0);
}

const pathFfmpeg = resolveOnPath('ffmpeg');
if (pathFfmpeg) {
  console.log(`[ffmpeg] FFmpeg já disponível no PATH: ${pathFfmpeg}`);
  console.log('[ffmpeg] Instalação local não é necessária.');
  process.exit(0);
}

if (!FFmpeg_URLS.length) {
  console.log('[ffmpeg] Instalação automática suportada apenas no Windows.');
  console.log('[ffmpeg] Instale o FFmpeg manualmente e adicione ao PATH: https://ffmpeg.org/download.html');
  process.exit(1);
}

console.log('[ffmpeg] Baixando FFmpeg...');

const zipPath = path.join(os.tmpdir(), `ffmpeg-${Date.now()}.zip`);
const extractDir = path.join(os.tmpdir(), `ffmpeg-extract-${Date.now()}`);

try {
  const downloadStartedAt = Date.now();
  console.log('[ffmpeg] Etapa 1/4: tentando fontes de download...');
  const downloaded = await downloadFromSources(zipPath);
  if (!downloaded) throw new Error('Nenhuma fonte de download respondeu com sucesso.');
  console.log(`[ffmpeg] Etapa 1 concluída em ${formatElapsed(Date.now() - downloadStartedAt)}`);

  const sevenZipStartedAt = Date.now();
  console.log('[ffmpeg] Etapa 2/4: preparando 7-Zip...');
  fs.mkdirSync(extractDir, { recursive: true });
  console.log('[ffmpeg] Extraindo...');
  const sevenZip = downloaded.archiveType === '7z' ? ((await ensureSevenZip()) || resolveSevenZip()) : null;
  if (downloaded.archiveType === '7z' && !sevenZip) {
    throw new Error(
      'Não foi possível preparar o 7-Zip automaticamente. Instale o 7-Zip manualmente e tente novamente.'
    );
  }
  if (sevenZip) console.log(`[ffmpeg] 7-Zip pronto: ${sevenZip}`);
  console.log(`[ffmpeg] Etapa 2 concluída em ${formatElapsed(Date.now() - sevenZipStartedAt)}`);

  const extractStartedAt = Date.now();
  console.log('[ffmpeg] Etapa 3/4: extraindo arquivo...');
  if (downloaded.archiveType === 'zip') {
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
    if (r.status !== 0) throw new Error(`Falha ao extrair ZIP: ${r.stderr || r.stdout || 'erro desconhecido'}`);
  } else {
    const r = spawnSync(sevenZip, ['x', '-y', `-o${extractDir}`, zipPath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
    });
    if (r.status !== 0) throw new Error(`Falha ao extrair: ${r.stderr || r.stdout || 'erro desconhecido'}`);
  }
  console.log(`[ffmpeg] Etapa 3 concluída em ${formatElapsed(Date.now() - extractStartedAt)}`);

  // Localiza o ffmpeg.exe dentro da estrutura ffmpeg-*-essentials_build/bin/
  const copyStartedAt = Date.now();
  console.log('[ffmpeg] Etapa 4/4: copiando binário...');
  const found = findFile(extractDir, BIN_NAME);
  if (!found) throw new Error(`binário ${BIN_NAME} não encontrado no arquivo baixado`);
  const binDir = path.dirname(found);

  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  copyBinDirectory(binDir, VENDOR_DIR);
  const versionLine = getVersionLine(found) || getVersionLine(BIN_PATH) || 'unknown';
  fs.writeFileSync(INSTALLED_MARKER, JSON.stringify({
    installedAt: new Date().toISOString(),
    source: downloaded.source,
    binary: BIN_PATH,
    version: versionLine,
  }, null, 2));
  fs.writeFileSync(INSTALLED_VERSION, `${versionLine}\n`);
  console.log(`[ffmpeg] Instalado em: ${BIN_PATH}`);
  console.log(`[ffmpeg] Etapa 4 concluída em ${formatElapsed(Date.now() - copyStartedAt)}`);

  const ver = runLocal(['-version']);
  console.log(`[ffmpeg] Versão: ${formatVersion(ver)}`);
  console.log(`[ffmpeg] ✅ FFmpeg pronto em ${formatElapsed(Date.now() - installStartedAt)}`);
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

/** Copia todo o conteúdo de uma pasta para outra. */
function copyBinDirectory(srcDir, dstDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyBinDirectory(src, dst);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
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

/** Verifica se a instalação local já está pronta para uso. */
function isLocalFfmpegReady() {
  if (!fs.existsSync(BIN_PATH) || !fs.existsSync(INSTALLED_MARKER)) return false;
  return checkLocalBinary(BIN_PATH);
}

/** Valida se um binário de FFmpeg responde a `-version`. */
function checkLocalBinary(binaryPath) {
  try {
    const r = spawnSync(binaryPath, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    return r.status === 0 && /ffmpeg version/i.test(`${r.stdout}\n${r.stderr}`);
  } catch {
    return false;
  }
}

/** Extrai a primeira linha da versão do FFmpeg. */
function getVersionLine(binaryPath) {
  try {
    const r = spawnSync(binaryPath, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const text = `${r.stdout || ''}${r.stderr || ''}`.trim();
    return text ? text.split(/\r?\n/)[0] : null;
  } catch {
    return null;
  }
}

/** Formata a primeira linha útil da versão para exibição. */
function formatVersion(output) {
  if (!output) return '?';
  const firstLine = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine || '?';
}

/** Tenta baixar de várias fontes em ordem de preferência. */
async function downloadFromSources(zipPath) {
  let lastError = null;
  for (const source of FFmpeg_URLS) {
    try {
      console.log(`[ffmpeg] Fonte: ${source.label}`);
      const res = await fetch(source.url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const total = Number(res.headers.get('content-length') || 0);
      const buf = await downloadWithProgress(res, total);
      fs.writeFileSync(zipPath, buf);
      console.log(`\r[ffmpeg] Baixado: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
      return source;
    } catch (err) {
      lastError = err;
      console.log(`[ffmpeg] Falhou em ${source.label}: ${err.message}`);
    }
  }
  if (lastError) throw lastError;
  return null;
}

/** Resolve um executável no PATH usando `where`. */
function resolveOnPath(name) {
  const r = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const found = r.stdout.split(/\r?\n/).find(Boolean);
  return found ? found.trim() : null;
}

/** Localiza um executável 7-Zip no PATH. */
function resolveSevenZip() {
  const candidates = ['7z.exe', '7za.exe'];
  for (const candidate of candidates) {
    const r = spawnSync('where', [candidate], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) {
      const found = r.stdout.split(/\r?\n/).find(Boolean);
      if (found) return found.trim();
    }
  }
  return null;
}

/** Baixa e instala uma cópia local temporária do 7-Zip se necessário. */
async function ensureSevenZip() {
  const existing = resolveSevenZip();
  if (existing) return existing;
  if (!SEVEN_ZIP_URL) return null;

  console.log('[ffmpeg] 7-Zip não encontrado, baixando uma cópia temporária...');
  const tempDir = path.join(os.tmpdir(), `7zip-${Date.now()}`);
  const installerPath = path.join(os.tmpdir(), `7zip-installer-${Date.now()}.exe`);

  try {
    const res = await fetch(SEVEN_ZIP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const total = Number(res.headers.get('content-length') || 0);
    const buf = await downloadWithProgress(res, total);
    fs.writeFileSync(installerPath, buf);
    console.log(`\r[ffmpeg] 7-Zip baixado: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

    fs.mkdirSync(tempDir, { recursive: true });
    const r = spawnSync(
      installerPath,
      ['/S', `/D=${tempDir}`],
      { encoding: 'utf8', windowsHide: true, timeout: 180000 }
    );
    if (r.status !== 0) throw new Error(`Falha ao instalar 7-Zip: ${r.stderr || r.stdout || 'erro desconhecido'}`);

    const installed = path.join(tempDir, '7z.exe');
    if (fs.existsSync(installed)) return installed;

    const installedAlt = path.join(tempDir, '7za.exe');
    if (fs.existsSync(installedAlt)) return installedAlt;

    throw new Error('7-Zip instalado, mas o executável não foi encontrado.');
  } finally {
    try { fs.rmSync(installerPath, { force: true }); } catch { /* ignora */ }
  }
}

/** Baixa um response com progresso simples no terminal. */
async function downloadWithProgress(res, total) {
  if (!res.body) return Buffer.from(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let lastRender = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    const now = Date.now();
    if (now - lastRender >= 200) {
      lastRender = now;
      renderProgress(received, total);
    }
  }

  renderProgress(received, total, true);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/** Renderiza uma linha de progresso simples no terminal. */
function renderProgress(received, total, done = false) {
  const mb = (received / 1024 / 1024).toFixed(1);
  const line = total > 0
    ? (() => {
        const pct = Math.min(100, ((received / total) * 100).toFixed(1));
        const totalMb = (total / 1024 / 1024).toFixed(1);
        return `[ffmpeg] Baixando... ${pct}% (${mb} / ${totalMb} MB)`;
      })()
    : `[ffmpeg] Baixando... ${mb} MB`;

  if (total > 0) {
    process.stdout.write(`\r${line}${done ? '\n' : ' '}`);
    return;
  }

  process.stdout.write(`\r${line}${done ? '\n' : ' '}`);
}

/** Formata duração em segundos e minutos para logs. */
function formatElapsed(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}
