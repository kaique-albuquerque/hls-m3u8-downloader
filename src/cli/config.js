import fs from 'node:fs';
import path from 'node:path';
import { normalizeHeaders } from '../utils.js';
import { createSettingsStore, DEFAULT_SETTINGS } from '../core/settings.js';

export function loadConfig(projectRoot, io) {
  const configPath = path.join(projectRoot, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      // Caminhos relativos de cookies.txt sao resolvidos a partir da raiz do projeto.
      const cookiesFile = raw.cookiesFile ? path.resolve(projectRoot, raw.cookiesFile) : '';
      return {
        headers: raw.headers || {},
        cookiesFile,
        cookiesFromBrowser: raw.cookiesFromBrowser || '',
        turbo: raw.turbo === true,
        turboChunks: Number(raw.turboChunks) > 0 ? Number(raw.turboChunks) : 8,
      };
    }
  } catch (err) {
    io.log(`[AVISO] config.json invalido: ${err.message}`);
  }
  return { headers: {}, cookiesFile: '', cookiesFromBrowser: '', turbo: false, turboChunks: 8 };
}

/**
 * P7 — Funde o config.json legado com os settings persistidos (settings.js).
 *
 * Regra: settings P7 vencem sobre o config.json legado (config.json e
 * tratado como default antigo). `io` opcional para avisos; `settingsFile`
 * opcional (testes). Retorna o objeto loadConfig + `settings` (store P7).
 */
export function mergeConfigWithSettings({ projectRoot, io = { log() {} }, settingsFile }) {
  const legacy = loadConfig(projectRoot, io);
  const file = settingsFile || path.join(projectRoot, 'streamgrab.settings.json');
  const settings = createSettingsStore({ file });
  const merged = { ...legacy };

  const st = settings.all();
  merged.turbo = st.turbo;
  merged.turboChunks = st.turboChunks;
  merged.defaultDir = st.defaultDir || '';
  merged.maxConcurrentDownloads = st.maxConcurrentDownloads;
  merged.defaultQuality = st.defaultQuality;
  merged.audio = st.audio;
  merged.notifications = st.notifications;
  merged.onComplete = st.onComplete;
  merged.historyRetentionDays = st.historyRetentionDays;
  merged.settings = settings;
  merged.defaults = { ...DEFAULT_SETTINGS };
  return merged;
}

export function parseCliHeaders(argv) {
  const headers = {};
  const map = {
    '--referer': 'Referer',
    '--origin': 'Origin',
    '--user-agent': 'User-Agent',
    '--useragent': 'User-Agent',
    '--cookie': 'Cookie',
  };
  for (let i = 0; i < argv.length; i++) {
    const key = map[argv[i]];
    if (key && argv[i + 1] !== undefined) headers[key] = argv[i + 1];
  }
  return headers;
}

/**
 * Flags de autenticacao do yt-dlp:
 *   --cookies <arquivo>           cookies.txt (formato Netscape exportado do navegador)
 *   --cookies-from-browser <b>    extrai cookies do navegador (chrome, edge, firefox, brave...)
 */
export function parseCliAuth(argv) {
  const auth = { cookiesFile: '', cookiesFromBrowser: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cookies' && argv[i + 1] !== undefined) auth.cookiesFile = argv[i + 1];
    if (argv[i] === '--cookies-from-browser' && argv[i + 1] !== undefined) auth.cookiesFromBrowser = argv[i + 1];
  }
  return auth;
}

export function isGoogleVideoPlaybackUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().includes('googlevideo.com') && u.pathname.toLowerCase().includes('/videoplayback');
  } catch {
    return false;
  }
}

export async function collectDevtoolsHeaders(ask, io, currentHeaders = {}) {
  io.log('\nURL direta do YouTube/GoogleVideo detectada.');
  io.log('Se quiser, cole os mesmos headers usados pelo navegador para aumentar a chance de funcionar.');

  const referer = (await ask(`Referer (Enter = ${currentHeaders.Referer || 'manter atual/ignorar'}): `)).trim();
  const origin = (await ask(`Origin (Enter = ${currentHeaders.Origin || 'manter atual/ignorar'}): `)).trim();
  const userAgent = (await ask(`User-Agent (Enter = ${currentHeaders['User-Agent'] || 'manter atual/ignorar'}): `)).trim();
  const cookie = (await ask('Cookie (opcional, Enter = ignorar): ')).trim();

  return normalizeHeaders({
    ...currentHeaders,
    ...(referer ? { Referer: referer } : {}),
    ...(origin ? { Origin: origin } : {}),
    ...(userAgent ? { 'User-Agent': userAgent } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
  });
}
