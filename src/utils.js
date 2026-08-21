import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_USER_AGENT } from './core/url-utils.js';
import { normalizeHeaders } from './core/header-utils.js';

// Re-exports from focused modules (Sprint 2.3) — backward compatible.
export { DEFAULT_USER_AGENT, normalizeUrl, isValidM3u8Url, maskUrl } from './core/url-utils.js';
export { formatBytes, formatKbps } from './core/format-utils.js';
export { normalizeHeaders } from './core/header-utils.js';

// ---------------------------------------------------------------------------
// Remaining utilities (to be migrated to focused modules incrementally)
// ---------------------------------------------------------------------------

// Caracteres inválidos em nomes de arquivo no Windows.
const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*]/g;

// Nomes reservados pelo Windows (CON, PRN, AUX, NUL, COM1..9, LPT1..9).
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const DIRECT_MEDIA_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ts']);

export function detectSourceType(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'unknown';
    if (isYouTubeUrl(value)) return 'youtube';
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.toLowerCase();
    if (pathname.includes('.m3u8')) return 'hls';
    if (pathname.includes('.mpd')) return 'dash';
    if (host.includes('googlevideo.com') && pathname.includes('/videoplayback')) return 'direct';
    if (host.includes('play.mlstatic.com')) return 'mercadoplay'; // Mercado Play (mdstrm)
    if (isSocialMediaUrl(value)) return 'social';
    const ext = pathname.match(/\.([a-z0-9]{1,5})$/i)?.[1] || '';
    if (DIRECT_MEDIA_EXTENSIONS.has(ext)) return 'direct';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function isSupportedMediaUrl(value) {
  return detectSourceType(value) !== 'unknown';
}

export function isYouTubeUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  } catch {
    return false;
  }
}

/**
 * Hosts de redes sociais / plataformas de video suportadas pelo yt-dlp.
 * Qualquer um deles é roteado para o adaptador social (motor yt-dlp).
 */
export const SOCIAL_HOSTS = new Set([
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch', 'www.fb.watch',
  'instagram.com', 'www.instagram.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com',
  'reddit.com', 'www.reddit.com', 'old.reddit.com', 'v.redd.it',
  'linkedin.com', 'www.linkedin.com',
  'twitch.tv', 'www.twitch.tv', 'clips.twitch.tv',
  'vimeo.com', 'www.vimeo.com', 'player.vimeo.com',
  'dailymotion.com', 'www.dailymotion.com', 'dai.ly',
  'bilibili.com', 'www.bilibili.com',
  'vk.com', 'm.vk.com',
  'pinterest.com', 'www.pinterest.com', 'pin.it',
  'rumble.com', 'www.rumble.com',
  'odysee.com', 'www.odysee.com',
  'streamable.com', 'www.streamable.com',
  'vidmoly.me', 'www.vidmoly.me',
  'videos.pexels.com',
]);

export function isSocialMediaUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return SOCIAL_HOSTS.has(host);
  } catch {
    return false;
  }
}

const SOCIAL_LABELS = {
  'facebook.com': 'Facebook', 'fb.watch': 'Facebook',
  'instagram.com': 'Instagram',
  'tiktok.com': 'TikTok', 'vm.tiktok.com': 'TikTok',
  'x.com': 'X (Twitter)', 'twitter.com': 'X (Twitter)',
  'reddit.com': 'Reddit', 'v.redd.it': 'Reddit',
  'linkedin.com': 'LinkedIn',
  'twitch.tv': 'Twitch', 'clips.twitch.tv': 'Twitch',
  'vimeo.com': 'Vimeo',
  'dailymotion.com': 'Dailymotion',
  'bilibili.com': 'Bilibili',
  'vk.com': 'VK',
  'pinterest.com': 'Pinterest',
  'rumble.com': 'Rumble',
  'odysee.com': 'Odysee',
  'streamable.com': 'Streamable',
  'vidmoly.me': 'VidMoly',
};

/** Nome amigavel da plataforma social a partir da URL (ex.: "Facebook"). */
export function socialLabelForUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const exact = SOCIAL_LABELS[host];
    if (exact) return exact;
    for (const [key, label] of Object.entries(SOCIAL_LABELS)) {
      if (host.endsWith(`.${key}`) || key.endsWith(host)) return label;
    }
    return 'rede social';
  } catch {
    return 'rede social';
  }
}

/**
 * Sanitiza um nome de arquivo para ser seguro no Windows:
 * remove < > : " / \ | ? * e espaços/pontos finais.
 */
export function sanitizeFilename(name) {
  let n = String(name ?? '').trim();
  n = n.replace(WINDOWS_INVALID_CHARS, '_');
  n = n.replace(/[.\s]+$/g, '');
  n = n.replace(/^[.\s]+/g, '');
  if (!n) n = 'video';
  const base = n.replace(/\.mp4$/i, '');
  if (RESERVED_NAMES.test(base)) n = `_${base}`;
  return n;
}

/**
 * Adiciona .mp4 automaticamente se o usuário não informou extensão.
 */
export function ensureMp4(name) {
  return /\.mp4$/i.test(name) ? name : `${name}.mp4`;
}

/**
 * Pasta padrão de saída no Windows: Downloads do usuário atual,
 * obtida programaticamente (sem nome de usuário hardcoded).
 */
export function getDefaultDownloadsDir() {
  const home = os.homedir();
  const candidates = [path.join(home, 'Downloads'), home, process.cwd()];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* tenta a próxima */
    }
  }
  return home;
}

/**
 * Probe rapido de content-type SEM baixar o corpo do arquivo.
 * 1) tenta HEAD; 2) se o servidor nao aceitar (405/403/erro), faz GET com
 * Range: bytes=0-0 e aborta assim que os headers chegam (o corpo nunca e lido).
 * Seguranca extra: timeout de 8s. Retorna '' se nao conseguir detectar.
 */
export async function probeMediaContentType(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const hdrs = { 'User-Agent': DEFAULT_USER_AGENT, ...normalizeHeaders(headers) };
    let res = null;
    try {
      res = await fetch(url, { method: 'HEAD', headers: hdrs, redirect: 'follow', signal: controller.signal });
      if (res.ok) {
        const ct = (res.headers.get('content-type') || '').trim();
        if (ct) return ct;
      }
    } catch {
      /* HEAD indisponivel → tenta GET com Range */
    }
    res = await fetch(url, {
      method: 'GET',
      headers: { ...hdrs, Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    return (res.headers.get('content-type') || '').trim();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
    try {
      controller.abort();
    } catch {
      /* ja abortado */
    }
  }
}

/**
 * Content-types tratados como midia direta (video/*, audio/* e alguns conhecidos).
 * Nao inclui application/x-mpegurl / vnd.apple.mpegurl (esses sao HLS, que so
 * deve ser detectado pela extensao .m3u8).
 */
export function isDirectMediaContentType(contentType) {
  if (!contentType) return false;
  const base = contentType.toLowerCase().trim().split(';')[0].trim();
  if (base.startsWith('video/')) return true;
  if (base.startsWith('audio/')) return true;
  return base === 'application/mp4' || base === 'application/octet-stream';
}

/**
 * Lê o conteúdo da área de transferência do Windows via PowerShell.
 * (spawn, sem exec — sem risco de injeção de comando)
 */
export function getClipboardText() {
  try {
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    if (res.status === 0 && res.stdout) {
      return String(res.stdout).trim();
    }
  } catch {
    /* clipboard indisponível (sem Windows/PowerShell) */
  }
  return '';
}
