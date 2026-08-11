import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_DIR = path.join(PROJECT_ROOT, 'node_modules', 'electron');
const DIST_DIR = path.join(ELECTRON_DIR, 'dist');
const PATH_FILE = path.join(ELECTRON_DIR, 'path.txt');

console.log('\n[electron] Verificando instalação local do Electron...');

if (!fs.existsSync(ELECTRON_DIR)) {
  console.log('[electron] Pacote electron não encontrado em node_modules. Nada a fazer.');
  process.exit(0);
}

const electronPkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_DIR, 'package.json'), 'utf8'));
const electronVersion = electronPkg.version;
const platformPath = getPlatformPath();

if (isElectronReady()) {
  console.log(`[electron] Já instalado: ${path.join(DIST_DIR, platformPath)}`);
  process.exit(0);
}

const installScript = path.join(ELECTRON_DIR, 'install.js');
if (fs.existsSync(installScript)) {
  console.log('[electron] Tentando instalador oficial do pacote...');
  const run = spawnSync(process.execPath, [installScript], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (run.status === 0 && isElectronReady()) {
    console.log('[electron] Instalação concluída pelo instalador oficial.');
    process.exit(0);
  }
}

console.log('[electron] Instalador do pacote não concluiu. Aplicando recuperação automática...');

main().catch((error) => {
  console.error(`[electron] Falha ao preparar o Electron: ${error.message}`);
  process.exitCode = 1;
});

function isElectronReady() {
  try {
    if (!fs.existsSync(PATH_FILE)) return false;
    const savedPath = fs.readFileSync(PATH_FILE, 'utf8').trim();
    if (savedPath !== platformPath) return false;
    return fs.existsSync(path.join(DIST_DIR, savedPath));
  } catch {
    return false;
  }
}

function getPlatformPath() {
  const platform = process.env.npm_config_platform || os.platform();

  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error(`Electron não possui build para a plataforma: ${platform}`);
  }
}

async function main() {
  const { downloadArtifact } = require('@electron/get');
  const checksums = require(path.join(ELECTRON_DIR, 'checksums.json'));

  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;

  const zipPath = await downloadArtifact({
    version: electronVersion,
    artifactName: 'electron',
    platform,
    arch,
    checksums,
    cacheRoot: process.env.electron_config_cache,
    force: process.env.force_no_cache === 'true',
  });

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
  extractArchive(zipPath, DIST_DIR);

  const extractedTypeDef = path.join(DIST_DIR, 'electron.d.ts');
  const rootTypeDef = path.join(ELECTRON_DIR, 'electron.d.ts');
  if (fs.existsSync(extractedTypeDef)) {
    fs.renameSync(extractedTypeDef, rootTypeDef);
  }

  fs.writeFileSync(PATH_FILE, platformPath);

  if (!isElectronReady()) {
    throw new Error('o binário do Electron ainda não ficou utilizável após a extração');
  }

  console.log(`[electron] Recuperado com sucesso: ${path.join(DIST_DIR, platformPath)}`);
}

function extractArchive(zipPath, destinationDir) {
  if (process.platform === 'win32') {
    const extract = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destinationDir}' -Force`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 180000 }
    );

    if (extract.status !== 0) {
      throw new Error(`falha ao extrair ZIP do Electron: ${extract.stderr || extract.stdout || 'erro desconhecido'}`);
    }

    return;
  }

  throw new Error('recuperação automática do Electron ainda não foi implementada para esta plataforma');
}
