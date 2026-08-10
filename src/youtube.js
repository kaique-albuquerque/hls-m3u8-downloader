function parseJsonAssignment(text, variableName) {
  const needle = `${variableName} = `;
  const start = text.indexOf(needle);
  if (start === -1) return null;

  let i = start + needle.length;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  const begin = i;

  for (; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(begin, i + 1);
      }
    }
  }
  return null;
}

function parseMimeType(format) {
  const mime = String(format?.mimeType || '');
  const container = mime.match(/^[^/]+\/([a-z0-9]+)/i)?.[1] || '';
  const codecs = mime.match(/codecs="([^"]+)"/i)?.[1] || '';
  return { mime, container, codecs };
}

function normalizeYouTubeFormat(format) {
  const { mime, container, codecs } = parseMimeType(format);
  return {
    itag: Number(format?.itag) || 0,
    url: format?.url || '',
    mimeType: mime,
    container,
    codecs,
    qualityLabel: format?.qualityLabel || '',
    bitrate: Number(format?.bitrate) || 0,
    width: Number(format?.width) || 0,
    height: Number(format?.height) || 0,
    audioQuality: format?.audioQuality || '',
    hasVideo: Number(format?.width) > 0 || /video\//i.test(mime),
    hasAudio: Boolean(format?.audioQuality) || /mp4a|opus|vorbis|audio\//i.test(`${mime} ${codecs}`),
    contentLength: Number(format?.contentLength) || 0,
    signatureCipher: format?.signatureCipher || format?.cipher || '',
  };
}

function sortFormats(a, b) {
  return b.height - a.height || b.bitrate - a.bitrate || b.itag - a.itag;
}

export function isYouTubeWatchUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  } catch {
    return false;
  }
}

export async function fetchYouTubePage(url, headers = {}, timeoutMs = 30000) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': headers['User-Agent'] || headers['user-agent'] || 'Mozilla/5.0',
      ...headers,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
    err.status = res.status;
    throw err;
  }

  return { html: await res.text(), finalUrl: res.url || url };
}

export function extractInitialPlayerResponse(html) {
  const raw = parseJsonAssignment(String(html || ''), 'var ytInitialPlayerResponse')
    || parseJsonAssignment(String(html || ''), 'ytInitialPlayerResponse');
  if (!raw) {
    throw new Error('Nao foi possivel localizar ytInitialPlayerResponse na pagina do YouTube.');
  }
  return JSON.parse(raw);
}

export function parseYouTubePlayerResponse(playerResponse, pageUrl = '') {
  const videoDetails = playerResponse?.videoDetails || {};
  const streamingData = playerResponse?.streamingData || {};
  const progressiveFormats = (streamingData.formats || [])
    .map(normalizeYouTubeFormat)
    .filter((format) => format.url && format.hasVideo && format.hasAudio)
    .sort(sortFormats);

  const adaptiveFormats = (streamingData.adaptiveFormats || [])
    .map(normalizeYouTubeFormat)
    .sort(sortFormats);

  return {
    kind: 'youtube',
    pageUrl,
    title: videoDetails.title || 'YouTube Video',
    videoId: videoDetails.videoId || '',
    durationSeconds: Number(videoDetails.lengthSeconds) || 0,
    progressiveFormats,
    adaptiveFormats,
    hlsManifestUrl: streamingData.hlsManifestUrl || '',
    dashManifestUrl: streamingData.dashManifestUrl || '',
    variants: progressiveFormats.map((format) => ({
      uri: format.url,
      resolution: format.qualityLabel || (format.height ? `${format.height}p` : ''),
      width: format.width,
      height: format.height,
      bandwidth: format.bitrate,
      codecs: format.codecs,
      itag: format.itag,
      container: format.container,
    })),
  };
}

export async function analyzeYouTubeUrl(url, headers = {}) {
  const { html, finalUrl } = await fetchYouTubePage(url, headers);
  const playerResponse = extractInitialPlayerResponse(html);
  const parsed = parseYouTubePlayerResponse(playerResponse, finalUrl);

  if (!parsed.progressiveFormats.length) {
    const err = new Error(
      'Nenhum formato progressivo do YouTube foi encontrado. Esta primeira implementacao ainda nao cobre adaptive formats ou signatureCipher.'
    );
    err.code = 'YOUTUBE_PROGRESSIVE_UNAVAILABLE';
    err.playerResponse = playerResponse;
    throw err;
  }

  return parsed;
}

export async function prepareYouTubeDownload({ analysis, selectedUrl }) {
  const chosen = analysis?.progressiveFormats?.find((format) => format.url === selectedUrl)
    || analysis?.progressiveFormats?.[0];

  if (!chosen?.url) {
    const err = new Error('Nao foi possivel resolver uma URL progressiva do YouTube para download.');
    err.code = 'YOUTUBE_DOWNLOAD_URL_MISSING';
    throw err;
  }

  return {
    downloadUrl: chosen.url,
    chosenFormat: chosen,
  };
}
