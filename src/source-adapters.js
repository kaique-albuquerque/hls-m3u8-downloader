import { fetchPlaylist } from './hls.js';
import { fetchDashManifest } from './dash.js';
import { detectSourceType, isSocialMediaUrl, isYouTubeUrl } from './utils.js';
import { YOUTUBE_ADAPTER } from './adapters/youtube.js';
import { SOCIAL_ADAPTER } from './adapters/social.js';

export function resolveSourceAdapter(url) {
  if (isYouTubeUrl(url)) return YOUTUBE_ADAPTER;
  if (isSocialMediaUrl(url)) return SOCIAL_ADAPTER;

  const sourceType = detectSourceType(url);
  if (sourceType === 'hls') return HLS_ADAPTER;
  if (sourceType === 'dash') return DASH_ADAPTER;
  if (sourceType === 'direct') return DIRECT_ADAPTER;
  return UNKNOWN_ADAPTER;
}

const HLS_ADAPTER = {
  id: 'hls',
  label: 'HLS (.m3u8)',
  supportsQualitySelection: true,
  async analyze({ url, headers }) {
    return fetchPlaylist(url, headers);
  },
  async prepareDownload({ url }) {
    return { downloadUrl: url };
  },
};

const DASH_ADAPTER = {
  id: 'dash',
  label: 'DASH (.mpd)',
  supportsQualitySelection: false,
  async analyze({ url, headers }) {
    return fetchDashManifest(url, headers);
  },
  async prepareDownload({ url }) {
    return { downloadUrl: url };
  },
};

const DIRECT_ADAPTER = {
  id: 'direct',
  label: 'midia direta',
  supportsQualitySelection: false,
  async analyze() {
    return { kind: 'direct' };
  },
  async prepareDownload({ url }) {
    return { downloadUrl: url };
  },
};

const UNKNOWN_ADAPTER = {
  id: 'unknown',
  label: 'desconhecido',
  supportsQualitySelection: false,
  async analyze() {
    const err = new Error('Fonte nao suportada.');
    err.code = 'UNSUPPORTED_SOURCE';
    throw err;
  },
  async prepareDownload() {
    const err = new Error('Fonte nao suportada.');
    err.code = 'UNSUPPORTED_SOURCE';
    throw err;
  },
};
