import { extractPlayerJsUrl, fetchPlayerJs, resolveCipherFormats } from './youtube-signature.js';
import { fetchDashManifest } from '../dash.js';
import { fetchPlaylist } from '../hls.js';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: '*/*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  Origin: 'https://www.youtube.com',
  Referer: 'https://www.youtube.com/',
};

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

function parseJsonObjectAt(text, startIndex) {
  let i = startIndex;
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

function extractYtConfig(html) {
  const text = String(html || '');
  const direct = parseJsonAssignment(text, 'ytcfg.data_');
  if (direct) {
    try {
      return JSON.parse(direct);
    } catch {
      /* ignore */
    }
  }

  const setMatch = text.match(/ytcfg\.set\(\s*\{/);
  if (!setMatch) return {};
  const braceIndex = text.indexOf('{', setMatch.index);
  const raw = parseJsonObjectAt(text, braceIndex);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function extractYouTubeVideoId(url, playerResponse) {
  if (playerResponse?.videoDetails?.videoId) return playerResponse.videoDetails.videoId;
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() === 'youtu.be') return u.pathname.replace(/^\/+/, '');
    return u.searchParams.get('v') || '';
  } catch {
    return '';
  }
}

async function fetchYouTubePlayerApi({ videoId, html, headers = {}, timeoutMs = 30000 }) {
  const cfg = extractYtConfig(html);
  const apiKey = cfg?.INNERTUBE_API_KEY || cfg?.INNERTUBE_CONTEXT?.client?.apiKey || '';
  const clientName = cfg?.INNERTUBE_CLIENT_NAME || cfg?.INNERTUBE_CONTEXT?.client?.clientName || 'WEB';
  const clientVersion = cfg?.INNERTUBE_CLIENT_VERSION || cfg?.INNERTUBE_CONTEXT?.client?.clientVersion || '';
  if (!apiKey || !videoId) return null;

  const payload = {
    videoId,
    context: {
      client: {
        clientName,
        clientVersion,
        hl: 'pt-BR',
        gl: 'BR',
      },
    },
    contentCheckOk: true,
    racyCheckOk: true,
  };

  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      ...buildYouTubeRequestHeaders(headers),
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': String(clientName),
      ...(clientVersion ? { 'X-YouTube-Client-Version': String(clientVersion) } : {}),
    },
    body: JSON.stringify(payload),
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) return null;
  return res.json();
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

function isResolvableDirectFormat(format) {
  return Boolean(format.url);
}

function sortFormats(a, b) {
  return b.height - a.height || b.bitrate - a.bitrate || b.itag - a.itag;
}

function sortVariants(a, b) {
  const scoreA = `${a.sourceKind || ''}` === 'adaptive' ? 1 : 0;
  const scoreB = `${b.sourceKind || ''}` === 'adaptive' ? 1 : 0;
  return scoreB - scoreA || (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0) || (b.itag || 0) - (a.itag || 0);
}

function buildYouTubeRequestHeaders(headers = {}) {
  return {
    ...DEFAULT_HEADERS,
    ...headers,
  };
}

async function validateYouTubeMediaUrl(url, headers = {}, timeoutMs = 15000) {
  if (!url) return { ok: false, status: 0, reason: 'missing-url' };

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        ...buildYouTubeRequestHeaders(headers),
        Range: 'bytes=0-0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, status: 0, reason: err?.message || 'network-error' };
  }

  return {
    ok: res.status === 200 || res.status === 206,
    status: res.status,
    finalUrl: res.url || url,
  };
}

function findMatchingProgressiveFormat(analysis, selectedUrl) {
  return analysis?.progressiveFormats?.find((format) => format.url === selectedUrl) || null;
}

function findMatchingAdaptiveFormat(analysis, selectedUrl) {
  const adaptiveMatch = String(selectedUrl || '').match(/^youtube-adaptive:(\d+)$/);
  if (adaptiveMatch) {
    return analysis?.adaptiveVideoFormats?.find((format) => format.itag === Number(adaptiveMatch[1])) || null;
  }
  return null;
}

function parseManifestSelection(selectedUrl) {
  const match = String(selectedUrl || '').match(/^youtube-manifest:(dash|hls):/);
  return match ? match[1] : '';
}

function buildCandidatePlans(analysis, selectedUrl) {
  const candidates = [];
  const seen = new Set();
  const pushPlan = (plan) => {
    if (!plan) return;
    const key = JSON.stringify({
      strategy: plan.strategy,
      downloadUrl: plan.downloadUrl || '',
      videoUrl: plan.videoUrl || '',
      audioUrl: plan.audioUrl || '',
    });
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(plan);
  };

  const selectedProgressive = findMatchingProgressiveFormat(analysis, selectedUrl);
  const selectedAdaptive = findMatchingAdaptiveFormat(analysis, selectedUrl);
  const bestAudio = analysis?.adaptiveAudioFormats?.[0] || null;

  if (selectedAdaptive?.url && bestAudio?.url) {
    pushPlan({
      strategy: 'mux',
      videoUrl: selectedAdaptive.url,
      audioUrl: bestAudio.url,
      chosenVideoFormat: selectedAdaptive,
      chosenAudioFormat: bestAudio,
    });
  }

  if (selectedProgressive?.url) {
    pushPlan({
      strategy: 'single',
      downloadUrl: selectedProgressive.url,
      chosenFormat: selectedProgressive,
    });
  }

  for (const format of analysis?.adaptiveVideoFormats || []) {
    if (!format?.url || !bestAudio?.url) continue;
    pushPlan({
      strategy: 'mux',
      videoUrl: format.url,
      audioUrl: bestAudio.url,
      chosenVideoFormat: format,
      chosenAudioFormat: bestAudio,
    });
  }

  for (const format of analysis?.progressiveFormats || []) {
    if (!format?.url) continue;
    pushPlan({
      strategy: 'single',
      downloadUrl: format.url,
      chosenFormat: format,
    });
  }

  if (analysis?.dashManifestUrl) {
    pushPlan({
      strategy: 'manifest',
      manifestType: 'dash',
      downloadUrl: analysis.dashManifestUrl,
    });
  }

  if (analysis?.hlsManifestUrl) {
    pushPlan({
      strategy: 'manifest',
      manifestType: 'hls',
      downloadUrl: analysis.hlsManifestUrl,
    });
  }

  return candidates;
}

async function buildManifestVariants(streamingData, headers) {
  const variants = [];
  const seen = new Set();
  const pushVariant = (variant) => {
    if (!variant?.uri || seen.has(variant.uri)) return;
    seen.add(variant.uri);
    variants.push(variant);
  };

  if (streamingData?.dashManifestUrl) {
    try {
      const dashInfo = await fetchDashManifest(streamingData.dashManifestUrl, buildYouTubeRequestHeaders(headers));
      for (const rep of dashInfo.videoRepresentations || []) {
        pushVariant({
          uri: `youtube-manifest:dash:${rep.id || rep.height || rep.bandwidth || 'auto'}`,
          resolution: rep.height ? `${rep.height}p` : rep.resolution || 'auto',
          width: rep.width,
          height: rep.height,
          bandwidth: rep.bandwidth,
          codecs: rep.codecs,
          sourceKind: 'manifest-dash',
        });
      }
    } catch {
      pushVariant({
        uri: 'youtube-manifest:dash:auto',
        resolution: 'Auto (DASH)',
        width: 0,
        height: 0,
        bandwidth: 0,
        codecs: '',
        sourceKind: 'manifest-dash',
      });
    }
  }

  if (streamingData?.hlsManifestUrl) {
    try {
      const hlsInfo = await fetchPlaylist(streamingData.hlsManifestUrl, buildYouTubeRequestHeaders(headers));
      if (hlsInfo?.kind === 'master') {
        for (const variant of hlsInfo.variants || []) {
          pushVariant({
            uri: `youtube-manifest:hls:${variant.height || variant.bandwidth || 'auto'}`,
            resolution: variant.height ? `${variant.height}p` : variant.resolution || 'auto',
            width: variant.width,
            height: variant.height,
            bandwidth: variant.bandwidth,
            codecs: variant.codecs,
            sourceKind: 'manifest-hls',
          });
        }
      } else {
        pushVariant({
          uri: 'youtube-manifest:hls:auto',
          resolution: 'Auto (HLS)',
          width: 0,
          height: 0,
          bandwidth: 0,
          codecs: '',
          sourceKind: 'manifest-hls',
        });
      }
    } catch {
      pushVariant({
        uri: 'youtube-manifest:hls:auto',
        resolution: 'Auto (HLS)',
        width: 0,
        height: 0,
        bandwidth: 0,
        codecs: '',
        sourceKind: 'manifest-hls',
      });
    }
  }

  return variants.sort(sortVariants);
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

export function parseYouTubePlayerResponse(playerResponse, pageUrl = '', extraVariants = []) {
  const videoDetails = playerResponse?.videoDetails || {};
  const streamingData = playerResponse?.streamingData || {};
  const progressiveFormats = (streamingData.formats || [])
    .map(normalizeYouTubeFormat)
    .filter((format) => format.url && format.hasVideo && format.hasAudio)
    .sort(sortFormats);

  const adaptiveFormats = (streamingData.adaptiveFormats || [])
    .map(normalizeYouTubeFormat)
    .sort(sortFormats);

  const adaptiveVideoFormats = adaptiveFormats
    .filter((format) => format.hasVideo && !format.hasAudio && isResolvableDirectFormat(format))
    .sort(sortFormats);

  const adaptiveAudioFormats = adaptiveFormats
    .filter((format) => format.hasAudio && !format.hasVideo && isResolvableDirectFormat(format))
    .sort((a, b) => b.bitrate - a.bitrate || b.itag - a.itag);

  const variants = [
    ...progressiveFormats.map((format) => ({
      uri: format.url,
      resolution: format.qualityLabel || (format.height ? `${format.height}p` : ''),
      width: format.width,
      height: format.height,
      bandwidth: format.bitrate,
      codecs: format.codecs,
      itag: format.itag,
      container: format.container,
      sourceKind: 'progressive',
    })),
    ...adaptiveVideoFormats.map((format) => ({
      uri: `youtube-adaptive:${format.itag}`,
      resolution: format.qualityLabel || (format.height ? `${format.height}p` : ''),
      width: format.width,
      height: format.height,
      bandwidth: format.bitrate,
      codecs: format.codecs,
      itag: format.itag,
      container: format.container,
      sourceKind: 'adaptive',
    })),
    ...extraVariants,
  ].sort(sortVariants);

  return {
    kind: 'youtube',
    pageUrl,
    title: videoDetails.title || 'YouTube Video',
    videoId: videoDetails.videoId || '',
    durationSeconds: Number(videoDetails.lengthSeconds) || 0,
    progressiveFormats,
    adaptiveFormats,
    adaptiveVideoFormats,
    adaptiveAudioFormats,
    hlsManifestUrl: streamingData.hlsManifestUrl || '',
    dashManifestUrl: streamingData.dashManifestUrl || '',
    variants,
  };
}

export async function analyzeYouTubeUrl(url, headers = {}) {
  const { html, finalUrl } = await fetchYouTubePage(url, headers);
  let playerResponse = extractInitialPlayerResponse(html);
  const videoId = extractYouTubeVideoId(finalUrl || url, playerResponse);
  if (!playerResponse?.streamingData && videoId) {
    try {
      const apiPlayerResponse = await fetchYouTubePlayerApi({ videoId, html, headers });
      if (apiPlayerResponse?.streamingData) {
        playerResponse = {
          ...playerResponse,
          ...apiPlayerResponse,
          streamingData: apiPlayerResponse.streamingData,
          videoDetails: apiPlayerResponse.videoDetails || playerResponse.videoDetails,
          playabilityStatus: apiPlayerResponse.playabilityStatus || playerResponse.playabilityStatus,
        };
      }
    } catch {
      /* segue com a resposta do HTML */
    }
  }
  const playerJsUrl = extractPlayerJsUrl(html, finalUrl);

  if (playerJsUrl) {
    try {
      const playerJsText = await fetchPlayerJs(playerJsUrl, headers);
      if (playerResponse?.streamingData) {
        playerResponse.streamingData.formats = resolveCipherFormats(playerResponse.streamingData.formats, playerJsText);
        playerResponse.streamingData.adaptiveFormats = resolveCipherFormats(playerResponse.streamingData.adaptiveFormats, playerJsText);
      }
    } catch {
      /* segue com os formatos já resolvidos */
    }
  }

  const manifestVariants = await buildManifestVariants(playerResponse?.streamingData, headers);
  const parsed = parseYouTubePlayerResponse(playerResponse, finalUrl, manifestVariants);

  if (!parsed.progressiveFormats.length && !parsed.adaptiveVideoFormats.length && !parsed.dashManifestUrl && !parsed.hlsManifestUrl) {
    const err = new Error(
      'Nenhum formato do YouTube com URL direta ou manifesto utilizavel foi encontrado. Esta implementacao ainda nao conseguiu resolver os formatos protegidos do player.'
    );
    err.code = 'YOUTUBE_DIRECT_FORMAT_UNAVAILABLE';
    err.playerResponse = playerResponse;
    throw err;
  }

  return parsed;
}

export async function prepareYouTubeDownload({ analysis, selectedUrl, headers = {} }) {
  const manifestSelection = parseManifestSelection(selectedUrl);
  if (manifestSelection === 'dash' && analysis?.dashManifestUrl) {
    return {
      strategy: 'single',
      downloadUrl: analysis.dashManifestUrl,
      chosenFormat: { sourceKind: 'manifest-dash' },
    };
  }

  if (manifestSelection === 'hls' && analysis?.hlsManifestUrl) {
    return {
      strategy: 'single',
      downloadUrl: analysis.hlsManifestUrl,
      chosenFormat: { sourceKind: 'manifest-hls' },
    };
  }

  const candidates = buildCandidatePlans(analysis, selectedUrl);
  if (!candidates.length) {
    const err = new Error('Nao foi possivel resolver URLs do YouTube para download.');
    err.code = 'YOUTUBE_DOWNLOAD_URL_MISSING';
    throw err;
  }

  let lastFailure = null;

  for (const candidate of candidates) {
    if (candidate.strategy === 'single' || candidate.strategy === 'manifest') {
      const probe = await validateYouTubeMediaUrl(candidate.downloadUrl, headers);
      if (probe.ok) {
        return candidate.strategy === 'manifest'
          ? {
            strategy: 'single',
            downloadUrl: candidate.downloadUrl,
            chosenFormat: { sourceKind: `manifest-${candidate.manifestType}` },
          }
          : candidate;
      }
      lastFailure = `${candidate.strategy}:${probe.status || probe.reason}`;
      continue;
    }

    const videoProbe = await validateYouTubeMediaUrl(candidate.videoUrl, headers);
    if (!videoProbe.ok) {
      lastFailure = `video:${videoProbe.status || videoProbe.reason}`;
      continue;
    }

    const audioProbe = await validateYouTubeMediaUrl(candidate.audioUrl, headers);
    if (!audioProbe.ok) {
      lastFailure = `audio:${audioProbe.status || audioProbe.reason}`;
      continue;
    }

    return candidate;
  }

  const err = new Error('As URLs de midia do YouTube foram resolvidas, mas nenhuma passou na validacao de download.');
  err.code = 'YOUTUBE_DOWNLOAD_URL_INVALID';
  err.details = lastFailure;
  throw err;
}
