/**
 * P10 — Atualiza o binário do yt-dlp (scripts/update-ytdlp.mjs)
 *
 * Baixa o release "latest" do yt-dlp do GitHub e substitui o binário em:
 *  - node_modules/youtube-dl-exec/bin/  (usado em desenvolvimento)
 *  - tools/yt-dlp.exe                   (se existir)
 *  - build/extraResources/bin/          (se já empacotado)
 *
 * Validações:
 *  - assets correspondentes à plataforma (yt-dlp.exe no Windows);
 *  - `--version` do binário baixado antes de substituir;
 *  - erro de rede/API com mensagem clara e exit code 1.
 *
 * Uso: npm run update:ytdlp
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const GITHUB_API_URL =
  process.env.STREAMGRAB_YTDLP_URL ||
  'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const EXE = process.platform === 'win32' ? '.exe' : '';
const ASSET_NAME = `yt-dlp${EXE}`;
const UA = 'streamgrab-update-ytdlp';

/** Extrai a versão da saída de `yt-dlp --version` ('' se inválida). */
export function parseVersion(stdout) {
  const m = String(stdout || '').trim().match(/^(\d{4}(?:\.\d{2,3}){1,2})/);
  return m ? m[1] : '';
}

/** Escolhe o asset de download correto para a plataforma (puro, testável). */
export function pickAsset(assets, { platform = process.platform } = {}) {
  const list = Array.isArray(assets) ? assets : [];
  const wanted = platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const asset = list.find((a) => a?.name === wanted);
  return asset?.browser_download_url || null;
}

/** Destinos do binário (arquivos que existem no projeto). */
export function targetPaths(projectRoot = PROJECT_ROOT) {
  const targets = [
    path.join(projectRoot, 'node_modules', 'youtube-dl-exec', 'bin', `yt-dlp${EXE}`),
    path.join(projectRoot, 'tools', `yt-dlp${EXE}`),
    path.join(projectRoot, 'build', 'extraResources', 'bin', `yt-dlp${EXE}`),
  ];
  return targets.filter((p) => fs.existsSync(p));
}

/** Baixa o asset para um arquivo temporário. */
async function downloadToTemp(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) {
    throw new Error(`Falha ao baixar o yt-dlp (HTTP ${res.status} ${res.statusText}).`);
  }
  const tmp = path.join(os.tmpdir(), `yt-dlp-${Date.now()}${EXE}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmp, buf);
  return tmp;
}

/** Valida `--version` do binário baixado; retorna a versão ou lança. */
function validateVersion(binPath) {
  const r = spawnSync(binPath, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const version = parseVersion(r.stdout);
  if (!version) {
    throw new Error(
      `Binário baixado não é um yt-dlp válido (--version falhou): ${r.stderr || r.stdout || 'sem saída'}.`
    );
  }
  return version;
}

export async function main() {
  console.log('\n[update:ytdlp] Buscando release mais recente do yt-dlp...');
  const res = await fetch(GITHUB_API_URL, { headers: { 'user-agent': UA } });
  if (!res.ok) {
    throw new Error(
      `Falha ao consultar releases do yt-dlp (HTTP ${res.status}). ` +
        (res.status === 403 ? 'Limite de rate limit da API do GitHub — tente mais tarde.' : '')
    );
  }
  const release = await res.json();
  const url = pickAsset(release?.assets, { platform: process.platform });
  if (!url) {
    throw new Error(`Nenhum asset "${ASSET_NAME}" no release ${release?.tag_name || 'latest'}.`);
  }

  console.log(`[update:ytdlp] Baixando ${ASSET_NAME} (${release.tag_name})...`);
  const tmp = await downloadToTemp(url);
  try {
    const newVersion = validateVersion(tmp);
    const targets = targetPaths();
    if (!targets.length) {
      console.log(`[update:ytdlp] Nenhum destino encontrado (rode 'npm install' primeiro).`);
      return;
    }
    for (const target of targets) {
      fs.copyFileSync(tmp, target);
      console.log(`  ✔ ${target} → yt-dlp ${newVersion}`);
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignora */
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n[update:ytdlp] ERRO: ${err.message}`);
    process.exit(1);
  });
}
