import fs from 'node:fs';
import path from 'node:path';
import { normalizeHeaders } from '../utils.js';

export function loadConfig(projectRoot, io) {
  const configPath = path.join(projectRoot, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { headers: raw.headers || {} };
    }
  } catch (err) {
    io.log(`[AVISO] config.json invalido: ${err.message}`);
  }
  return { headers: {} };
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
