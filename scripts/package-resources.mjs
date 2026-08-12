/**
 * P10 — Empacota binários de runtime em build/extraResources/bin/
 * (seções 7 e 30 do architect.md).
 *
 * Copia FFmpeg, yt-dlp e (quando presente) curl-impersonate para
 * build/extraResources/bin/, de onde o electron-builder os coloca em
 * <app>/resources/bin/ no instalador. Em produção, src/core/binaries.js
 * resolve os binários a partir de <resourcesPath>/bin.
 *
 * ATENÇÃO (FFmpeg do gyan.dev): o ffmpeg.exe do vendor/ffmpeg é um build
 * COMPARTILHADO — depende das DLLs (avcodec-*.dll, avformat-*.dll etc.) na
 * mesma pasta. Sem elas, o app empacotado falha com STATUS_DLL_NOT_FOUND
 * (0xC0000135) ao iniciar o download. Por isso as DLLs de vendor/ffmpeg
 * também são copiadas.
 *
 * - ffmpeg e yt-dlp são OBRIGATÓRIOS (o instalador roda em máquina limpa,
 *   sem Node.js/FFmpeg/yt-dlp manuais): ausentes → exit 1 com mensagem.
 * - curl-impersonate é OPCIONAL (só existe se o usuário instalou em tools/):
 *   ausente → aviso e segue.
 * - Perfis v2 do curl-impersonate (curl_chromeNNN.bat etc.) são copiados
 *   junto quando presentes em tools/.
 *
 * Uso: npm run pack:resources
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'build', 'extraResources', 'bin');
const BIN_EXT = process.platform === 'win32' ? '.exe' : '';

/** Perfis v2 do curl-impersonate reconhecidos em tools/ (curl_chromeNNN.bat...). */
const PROFILE_BAT_RE = /^curl_(chrome|edge|safari|firefox)\d+(?:_\w+)?\.bat$/i;

/**
 * Monta o plano de empacotamento (puro, testável). `listTools` injetável.
 * Retorna { entries, batProfiles } onde cada entry é
 * { id, label, from, to, required }.
 */
export function buildResourcePlan({ projectRoot = PROJECT_ROOT, listTools = fs.readdirSync } = {}) {
  const entries = [
    {
      id: 'ffmpeg',
      label: 'FFmpeg (vendor/ffmpeg)',
      from: path.join(projectRoot, 'vendor', 'ffmpeg', `ffmpeg${BIN_EXT}`),
      to: `ffmpeg${BIN_EXT}`,
      required: true,
      // Build compartilhado (gyan.dev): copia também as DLLs da mesma pasta.
      depsDir: path.join(projectRoot, 'vendor', 'ffmpeg'),
    },
    {
      id: 'yt-dlp',
      label: 'yt-dlp (youtube-dl-exec/bin)',
      from: path.join(projectRoot, 'node_modules', 'youtube-dl-exec', 'bin', `yt-dlp${BIN_EXT}`),
      to: `yt-dlp${BIN_EXT}`,
      required: true,
    },
    {
      id: 'curl-impersonate',
      label: 'curl-impersonate (tools/)',
      from: path.join(projectRoot, 'tools', `curl-impersonate${BIN_EXT}`),
      to: `curl-impersonate${BIN_EXT}`,
      required: false,
    },
  ];

  let batProfiles = [];
  try {
    batProfiles = listTools(path.join(projectRoot, 'tools'))
      .filter((name) => PROFILE_BAT_RE.test(name))
      .map((name) => ({ from: path.join(projectRoot, 'tools', name), to: name }));
  } catch {
    /* tools/ ausente — ok, curl-impersonate é opcional */
  }

  return { entries, batProfiles };
}

/**
 * Executa o plano: cria o diretório de saída e copia cada entrada.
 * Entradas com `depsDir` (FFmpeg compartilhado) copiam também as DLLs da
 * pasta de origem — sem elas o exe empacotado não inicia. `listDir`
 * injetável para testes.
 * Binários obrigatórios ausentes → lança Error (exit 1 no main).
 */
export function runResourcePlan(
  plan,
  { outDir = OUT_DIR, copyFile = fs.copyFileSync, mkdir = fs.mkdirSync, listDir = fs.readdirSync } = {}
) {
  const missingRequired = plan.entries.filter((e) => e.required && !fs.existsSync(e.from));
  if (missingRequired.length) {
    const list = missingRequired.map((e) => `  - ${e.label} (${e.from})`).join('\n');
    throw new Error(
      `Binários obrigatórios ausentes para o empacotamento:\n${list}\n\n` +
        'Rode `npm install` (postinstall instala FFmpeg e yt-dlp) antes de `npm run dist`.'
    );
  }

  mkdir(outDir, { recursive: true });

  const copied = [];
  for (const entry of [...plan.entries, ...plan.batProfiles]) {
    if (!fs.existsSync(entry.from)) continue; // opcional ausente
    copyFile(entry.from, path.join(outDir, entry.to));
    copied.push(entry.to);

    // DLLs do FFmpeg compartilhado (ex.: avcodec-63.dll) — obrigatórias para
    // o ffmpeg.exe iniciar fora da pasta vendor/ffmpeg.
    if (entry.depsDir) {
      let names = [];
      try {
        names = listDir(entry.depsDir).filter((n) => /\.dll$/i.test(n));
      } catch {
        /* pasta de deps ausente — segue (o exe já foi copiado) */
      }
      for (const n of names) {
        copyFile(path.join(entry.depsDir, n), path.join(outDir, n));
        copied.push(n);
      }
    }
  }
  return copied;
}

export async function main() {
  const plan = buildResourcePlan();
  const copied = runResourcePlan(plan);

  console.log('\n[pack:resources] Binários empacotados em build/extraResources/bin/:');
  for (const name of copied) console.log(`  ✔ ${name}`);

  const optional = plan.entries.filter((e) => !e.required);
  for (const entry of optional) {
    if (!fs.existsSync(entry.from)) {
      console.log(`  ℹ ${entry.label} ausente — modo curl-impersonate indisponível no instalador.`);
    }
  }
  console.log('\n[pack:resources] Concluído.');
}

// Executa apenas quando chamado diretamente (não quando importado em testes).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n[pack:resources] ERRO: ${err.message}`);
    process.exit(1);
  });
}
