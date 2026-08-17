/**
 * P10 — Resolução de binários empacotados (src/core/binaries.js)
 *
 * Em desenvolvimento, cada mecanismo resolve seus binários nas pastas do
 * projeto (vendor/ffmpeg, node_modules/youtube-dl-exec/bin, PATH/tools).
 * Em produção (Electron empacotado), os binários ficam em extraResources,
 * dentro de <resourcesPath>/bin/ — empacotados por
 * scripts/package-resources.mjs.
 *
 * electron/main.js define STREAMGRAB_RESOURCES_PATH quando app.isPackaged;
 * este módulo é puro (sem electron) e lê apenas o ambiente, então pode ser
 * consumido por CLI, core e testes (seção 7 do architect.md).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raiz do projeto em desenvolvimento (vendor/, tools/, node_modules/). */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Variável de ambiente que aponta para o resourcesPath do app empacotado. */
export const RESOURCES_PATH_ENV = 'STREAMGRAB_RESOURCES_PATH';

/** Nome do binário por plataforma (Windows usa .exe). */
export function binName(base) {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

/** Retorna o resourcesPath empacotado ('' em desenvolvimento). */
export function getPackagedResourcesPath() {
  const raw = process.env[RESOURCES_PATH_ENV];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

/** Caminho completo de um binário empacotado ('' se não empacotado). */
export function packagedBinaryPath(name) {
  const root = getPackagedResourcesPath();
  return root ? path.join(root, 'bin', name) : '';
}

/** true se o binário empacotado existe — fs injetável para testes. */
export function hasPackagedBinary(name, { fsImpl = fs } = {}) {
  const p = packagedBinaryPath(name);
  return Boolean(p) && fsImpl.existsSync(p);
}

/**
 * Caminho do mp4decrypt (Bento4): empacotado (extraResources/bin) >
 * vendor/mp4decrypt/ > PATH.
 *
 * mp4decrypt é usado para descriptografar conteúdo CENC (Widevine/PlayReady)
 * após a aquisição de chaves via CDM/pywidevine (plano DRM, fase 1).
 */
export function getMp4decryptCommand() {
  const packaged = packagedBinaryPath(binName('mp4decrypt'));
  if (packaged && fs.existsSync(packaged)) return packaged;
  const local = path.join(PROJECT_ROOT, 'vendor', 'mp4decrypt', binName('mp4decrypt'));
  if (fs.existsSync(local)) return local;
  return 'mp4decrypt';
}

/** true se o mp4decrypt está disponível (vendor ou PATH). */
export function hasMp4decrypt() {
  return fs.existsSync(path.join(PROJECT_ROOT, 'vendor', 'mp4decrypt', binName('mp4decrypt')));
}

/**
 * Caminho da Widevine CDM (widevinecdm.dll): empacotado (extraResources/bin) >
 * vendor/widevine-cdm/.
 *
 * O CDM é necessário para gerar o device (pywidevine) que assina o challenge
 * de licença Widevine (plano DRM, fase 1). Retorna '' se ausente.
 */
export function getWidevineCdmPath() {
  const packaged = packagedBinaryPath(binName('widevinecdm'));
  if (packaged && fs.existsSync(packaged)) return packaged;
  const local = path.join(PROJECT_ROOT, 'vendor', 'widevine-cdm', binName('widevinecdm'));
  return fs.existsSync(local) ? local : '';
}

let cachedYtDlp = null;

/**
 * Instância do youtube-dl-exec: usa o binário empacotado em produção
 * (extraResources/bin/yt-dlp.exe); em desenvolvimento usa o binário
 * bundlado pelo pacote (default). Lazy + cache.
 *
 * Usa import() dinâmico de propósito: os testes mockam
 * 'youtube-dl-exec' via mock.module DEPOIS que este módulo já foi
 * avaliado — import estático capturaria o binding real na avaliação.
 * Import dinâmico resolve no momento da chamada e enxerga o mock.
 */
export async function getYtDlpExec({ fsImpl = fs } = {}) {
  if (cachedYtDlp) return cachedYtDlp;
  const packaged = packagedBinaryPath(binName('yt-dlp'));
  if (packaged && fsImpl.existsSync(packaged)) {
    const mod = await import('youtube-dl-exec');
    if (typeof mod.create === 'function') {
      cachedYtDlp = mod.create(packaged);
      return cachedYtDlp;
    }
  }
  const mod = await import('youtube-dl-exec');
  cachedYtDlp = mod.youtubeDl;
  return cachedYtDlp;
}

/** Reseta o cache do youtube-dl-exec (útil em testes). */
export function resetYtDlpCache() {
  cachedYtDlp = null;
}
