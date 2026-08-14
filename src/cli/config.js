import fs from 'node:fs';
import path from 'node:path';
import { normalizeHeaders } from '../utils.js';
import { createSettingsStore, DEFAULT_SETTINGS, normalizeSettings } from '../core/settings.js';

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
        // P6.2: false/null desliga (rollback); true|objeto liga o Smart Turbo.
        smartTurbo: raw.smartTurbo ?? false,
      };
    }
  } catch (err) {
    io.log(`[AVISO] config.json invalido: ${err.message}`);
  }
  return { headers: {}, cookiesFile: '', cookiesFromBrowser: '', turbo: false, turboChunks: 8, smartTurbo: false };
}

/**
 * P4.3 — Auto-migrate legacy config.json to streamgrab.settings.json.
 * Renames config.json to config.json.deprecated (never deletes).
 */
function migrateLegacyConfig(projectRoot, settings, io) {
  const configPath = path.join(projectRoot, 'config.json');
  const deprecatedPath = path.join(projectRoot, 'config.json.deprecated');
  try {
    if (!fs.existsSync(configPath)) return;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Merge known fields into the P7 settings store (settings wins on conflict)
    if (raw.headers && typeof raw.headers === 'object') {
      // headers are CLI-only, not stored in settings — skip
    }
    if (typeof raw.turbo === 'boolean' && !settings.all().turbo) {
      settings.set('turbo', raw.turbo);
    }
    if (Number(raw.turboChunks) > 0 && !settings.all().turboChunks) {
      settings.set('turboChunks', Number(raw.turboChunks));
    }
    if (raw.smartTurbo !== undefined && !settings.all().smartTurbo) {
      settings.set('smartTurbo', raw.smartTurbo);
    }

    // Rename to .deprecated (never delete — user may want to inspect)
    fs.renameSync(configPath, deprecatedPath);
    io.log('[config] config.json migrado para streamgrab.settings.json (renomeado para config.json.deprecated)');
  } catch {
    /* migration is best-effort — never breaks the app */
  }
}

/**
 * P7 — Merges legacy config.json with persisted settings (settings.js).
 *
 * Rule: P7 settings override legacy config.json (config.json is treated
 * as an old default). `io` optional for warnings; `settingsFile` optional
 * (tests). Returns the loadConfig object + `settings` (P7 store).
 */
export function mergeConfigWithSettings({ projectRoot, io = { log() {} }, settingsFile }) {
  const legacy = loadConfig(projectRoot, io);
  const file = settingsFile || path.join(projectRoot, 'streamgrab.settings.json');
  const settings = createSettingsStore({ file });

  // Sprint 4.3: auto-migrate legacy config.json on first detection
  migrateLegacyConfig(projectRoot, settings, io);

  const merged = { ...legacy };

  const st = normalizeSettings(settings.all());
  merged.turbo = st.turbo;
  merged.turboChunks = st.turboChunks;
  merged.smartTurbo = st.smartTurbo;
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
