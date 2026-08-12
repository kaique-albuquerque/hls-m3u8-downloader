import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_API_LATEST = 'https://api.github.com/repos/lexiforest/curl-impersonate/releases/latest';
const PROFILE_BAT_RE = /^curl_(chrome|edge|safari|firefox)\d+(?:_\w+)?\.bat$/i;
const DLL_RE = /\.dll$/i;

export function defaultInstallDir(projectRoot = process.cwd()) {
  return path.join(projectRoot, 'tools');
}

export function selectWindowsAsset(assets = []) {
  const ranked = assets
    .filter((asset) => {
      const name = String(asset?.name || '').toLowerCase();
      return (
        isSupportedArchive(name) &&
        /(win|windows|mingw|msvc)/.test(name) &&
        /(x64|win64|amd64|x86_64)/.test(name) &&
        !/(arm|aarch|i686|x86(?!_64))/i.test(name)
      );
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return ranked[0] || null;
}

function isSupportedArchive(name) {
  return (
    name.endsWith('.zip') ||
    name.endsWith('.tar.gz') ||
    name.endsWith('.tgz') ||
    name.endsWith('.tar.xz')
  );
}

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDirectoryContents(srcDir, dstDir) {
  ensureDir(dstDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(src, dst);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

function findBinaryDir(rootDir) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = entries.map((e) => e.name.toLowerCase());
    if (names.includes('curl-impersonate.exe')) return dir;
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
    }
  }
  return '';
}

function extractZip(zipPath, outDir) {
  const cmd = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`;
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', cmd],
    { encoding: 'utf8', windowsHide: true, timeout: 180000 }
  );
  if (r.status !== 0) throw new Error(`Falha ao extrair ZIP: ${r.stderr || r.stdout || 'erro desconhecido'}`);
}

function extractTar(archivePath, outDir) {
  const r = spawnSync(
    'tar.exe',
    ['-xf', archivePath, '-C', outDir],
    { encoding: 'utf8', windowsHide: true, timeout: 180000 }
  );
  if (r.status !== 0) {
    throw new Error(`Falha ao extrair TAR: ${r.stderr || r.stdout || 'erro desconhecido'}`);
  }
}

async function downloadBuffer(url, { headers = {}, io = console } = {}) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body) return Buffer.from(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let lastRender = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const now = Date.now();
    if (io?.log && total > 0 && now - lastRender > 250) {
      lastRender = now;
      const pct = ((received / total) * 100).toFixed(1);
      io.log(`[curl-impersonate] Baixando... ${pct}%`);
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export async function installCurlImpersonate({
  projectRoot = process.cwd(),
  installDir = defaultInstallDir(projectRoot),
  io = console,
  force = false,
} = {}) {
  if (process.platform !== 'win32') {
    return { ok: false, installed: false, reason: 'unsupported-platform' };
  }

  const exePath = path.join(installDir, 'curl-impersonate.exe');
  if (!force && fileExists(exePath)) {
    return { ok: true, installed: false, exePath, installDir };
  }

  ensureDir(installDir);
  const extractDir = path.join(os.tmpdir(), `curl-impersonate-extract-${Date.now()}`);
  let archivePath = '';

  try {
    io?.log?.('[curl-impersonate] Buscando release para Windows...');
    const releaseRes = await fetch(REPO_API_LATEST, {
      headers: {
        'User-Agent': 'StreamGrab/auto-installer',
        Accept: 'application/vnd.github+json',
      },
      redirect: 'follow',
    });
    if (!releaseRes.ok) {
      throw new Error(`Falha ao consultar releases: HTTP ${releaseRes.status} ${releaseRes.statusText}`);
    }
    const release = await releaseRes.json();
    const asset = selectWindowsAsset(release?.assets || []);
    if (!asset?.browser_download_url) {
      throw new Error('Nenhum asset ZIP para Windows x64 foi encontrado na release atual.');
    }

    io?.log?.(`[curl-impersonate] Baixando ${asset.name}...`);
    const zip = await downloadBuffer(asset.browser_download_url, {
      headers: { 'User-Agent': 'StreamGrab/auto-installer' },
      io,
    });
    archivePath = path.join(os.tmpdir(), `curl-impersonate-${Date.now()}-${asset.name}`);
    fs.writeFileSync(archivePath, zip);

    ensureDir(extractDir);
    io?.log?.('[curl-impersonate] Extraindo arquivos...');
    const lowerName = String(asset.name || '').toLowerCase();
    if (lowerName.endsWith('.zip')) extractZip(archivePath, extractDir);
    else extractTar(archivePath, extractDir);

    const binaryDir = findBinaryDir(extractDir);
    if (!binaryDir) throw new Error('curl-impersonate.exe não foi encontrado no arquivo baixado.');

    io?.log?.('[curl-impersonate] Instalando em tools/...');
    copyDirectoryContents(binaryDir, installDir);

    const installedExe = path.join(installDir, 'curl-impersonate.exe');
    if (!fileExists(installedExe)) throw new Error('A instalação terminou sem o executável esperado.');

    const profiles = fs.readdirSync(installDir).filter((name) => PROFILE_BAT_RE.test(name));
    const dlls = fs.readdirSync(installDir).filter((name) => DLL_RE.test(name));
    fs.writeFileSync(
      path.join(installDir, '.curl-impersonate-installed.json'),
      JSON.stringify(
        {
          installedAt: new Date().toISOString(),
          source: asset.browser_download_url,
          assetName: asset.name,
          profiles,
          dlls,
        },
        null,
        2
      )
    );

    io?.log?.(`[curl-impersonate] Pronto: ${installedExe}`);
    return { ok: true, installed: true, exePath: installedExe, installDir, profiles };
  } finally {
    try {
      if (archivePath) fs.rmSync(archivePath, { force: true });
    } catch {}
    try {
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch {}
  }
}
