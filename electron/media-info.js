/**
 * P8 — Normalização de MediaInfo/Format (seção 9 do architect.md)
 *
 * Converte a análise crua de qualquer provider (hls/dash/ytdlp/direct) em
 * uma estrutura normalizada para a UI do Electron:
 *
 *   MediaInfo { title, duration, thumbnail, sourceType, provider, protocol,
 *               formats[] }
 *   Format    { id, resolution, videoCodec, audioCodec, container, bitrate,
 *               estimatedSize, hasVideo, hasAudio, url }
 *
 * Módulo puro (sem Electron) — testável em Node.
 */

import { formatBytes, formatKbps } from '../src/utils.js';

const PROTOCOLS = {
  hls: 'HLS',
  dash: 'DASH',
  ytdlp: 'yt-dlp',
  youtube: 'yt-dlp',
  social: 'yt-dlp',
  direct: 'HTTP direto',
  unknown: 'desconhecido',
};

/** Formata duração (segundos) em "H:MM:SS" ou "MM:SS". */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Estima o tamanho (bytes) a partir de bitrate bps + duração em segundos. */
export function estimateSizeBytes(bitrate, durationSeconds) {
  const bps = Number(bitrate) || 0;
  const secs = Number(durationSeconds) || 0;
  if (bps <= 0 || secs <= 0) return 0;
  return Math.round((bps / 8) * secs);
}

/** Converte uma variante HLS/ytdlp (shape legado) em Format normalizado. */
export function normalizeVariantToFormat(variant, index) {
  const height = Number(variant?.height) || 0;
  const width = Number(variant?.width) || 0;
  const bitrate = Number(variant?.bandwidth || variant?.bitrate) || 0;
  const codecParts = String(variant?.codecs || '').split(',');
  const videoCodec = String(codecParts[0] || variant?.vcodec || '');
  const audioCodec = String(codecParts[1] || variant?.acodec || '');
  let resolution = variant?.resolution || '';
  if (!resolution && height) resolution = width ? `${width}x${height}` : `${height}p`;
  return {
    id: variant?.itag ? String(variant.itag) : `f${index + 1}`,
    resolution: resolution || 'Auto',
    videoCodec,
    audioCodec,
    container: String(variant?.container || variant?.ext || 'mp4'),
    bitrate,
    bitrateLabel: bitrate ? formatKbps(bitrate) : '',
    estimatedSize: 0,
    estimatedSizeLabel: '',
    hasVideo: true,
    hasAudio: variant?.hasAudio ?? (variant?.sourceKind !== 'adaptive'),
    url: String(variant?.uri || ''),
    legacyIndex: index,
  };
}

/** Converte uma representação DASH em Format normalizado. */
export function normalizeRepresentationToFormat(rep, index) {
  const height = Number(rep?.height) || 0;
  const width = Number(rep?.width) || 0;
  const bandwidth = Number(rep?.bandwidth) || 0;
  return {
    id: String(rep?.id || `dash-${index + 1}`),
    resolution: rep?.resolution || (width && height ? `${width}x${height}` : height ? `${height}p` : 'Auto'),
    videoCodec: String(rep?.codecs?.split(',')[0] || ''),
    audioCodec: '',
    container: 'mp4',
    bitrate: bandwidth,
    bitrateLabel: bandwidth ? formatKbps(bandwidth) : '',
    estimatedSize: 0,
    estimatedSizeLabel: '',
    hasVideo: true,
    hasAudio: true,
    url: String(rep?.baseUrl || ''),
    legacyIndex: index,
  };
}

/**
 * Normaliza a análise crua de um provider em MediaInfo.
 *
 * Aceita o shape legado retornado pelos adapters/providers:
 *  - master HLS: { kind:'master', variants[], baseUrl }
 *  - dash:       { kind:'dash', videoRepresentations[], baseUrl }
 *  - ytdlp:      { kind:'ytdlp', variants[], title, durationSeconds, thumbnail }
 *  - direct:     { kind:'direct', totalDuration }
 *  - media única: { kind:'media'|'unknown' }
 */
export function normalizeMediaInfo(raw = {}, { url = '', baseUrl = '', sourceType = '', provider = '' } = {}) {
  const kind = raw?.kind || 'unknown';
  const detectedSource = sourceType || raw?.sourceType || (kind === 'ytdlp' ? 'ytdlp' : kind);
  const protocol = PROTOCOLS[detectedSource] || PROTOCOLS[kind] || PROTOCOLS.unknown;

  const durationSeconds = Number(raw?.durationSeconds || raw?.totalDuration || 0) || 0;
  const title = String(raw?.title || 'Video');
  const thumbnail = String(raw?.thumbnail || raw?.thumbnails?.[0]?.url || '');

  let formats = [];
  if (kind === 'master' || kind === 'ytdlp' || kind === 'youtube') {
    formats = (Array.isArray(raw.variants) ? raw.variants : []).map(normalizeVariantToFormat);
  } else if (kind === 'dash') {
    formats = (Array.isArray(raw.videoRepresentations) ? raw.videoRepresentations : []).map(
      normalizeRepresentationToFormat
    );
  } else if (kind === 'direct' || kind === 'media' || kind === 'unknown') {
    formats = [
      {
        id: 'direct',
        resolution: 'Direto',
        videoCodec: '',
        audioCodec: '',
        container: 'mp4',
        bitrate: 0,
        bitrateLabel: '',
        estimatedSize: 0,
        estimatedSizeLabel: '',
        hasVideo: true,
        hasAudio: true,
        url: String(url || ''),
        legacyIndex: 0,
      },
    ];
  }

  // Tamanho estimado quando bitrate + duração conhecidos.
  for (const f of formats) {
    if (f.bitrate > 0 && durationSeconds > 0) {
      f.estimatedSize = estimateSizeBytes(f.bitrate, durationSeconds);
      f.estimatedSizeLabel = formatBytes(f.estimatedSize);
    }
  }

  const best = formats.find((f) => f.hasVideo) || null;

  return {
    title,
    duration: durationSeconds,
    durationLabel: formatDuration(durationSeconds),
    thumbnail,
    sourceType: detectedSource,
    protocol,
    provider: String(raw?.provider || provider || detectedSource),
    kind,
    baseUrl: String(baseUrl || raw?.baseUrl || url),
    pageUrl: String(raw?.pageUrl || url),
    formats,
    best,
    resolution: best?.resolution || '',
    codecs: best?.videoCodec || '',
    container: best?.container || '',
    bitrate: best?.bitrate || 0,
    bitrateLabel: best?.bitrateLabel || '',
    estimatedSize: best?.estimatedSize || 0,
    estimatedSizeLabel: best?.estimatedSizeLabel || '',
    // P12.1: audio tracks + subtitles (pass through from adapter)
    audioTracks: Array.isArray(raw?.audioTracks) ? raw.audioTracks : [],
    subtitleTracks: Array.isArray(raw?.subtitleTracks) ? raw.subtitleTracks : [],
  };
}

/** Cria um MediaInfo para fontes desconhecidas/erro (shape sempre estável). */
export function emptyMediaInfo({ url = '', sourceType = 'unknown', provider = '' } = {}) {
  return normalizeMediaInfo({ kind: sourceType || 'unknown' }, { url, sourceType, provider });
}
