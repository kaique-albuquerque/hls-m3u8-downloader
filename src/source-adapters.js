import { fetchPlaylist } from './hls.js';
import { fetchDashManifest } from './dash.js';
import { detectSourceType, isYouTubeUrl } from './utils.js';
import { analyzeYouTubeUrl, prepareYouTubeDownload } from './youtube.js';

export function resolveSourceAdapter(url) {
  if (isYouTubeUrl(url)) return YOUTUBE_ADAPTER;

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

const YOUTUBE_ADAPTER = {
  id: 'youtube',
  label: 'YouTube',
  supportsQualitySelection: true,
  async analyze({ url, headers }) {
    return analyzeYouTubeUrl(url, headers);
  },
  async prepareDownload({ analysis, selectedUrl }) {
    return prepareYouTubeDownload({ analysis, selectedUrl });
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
