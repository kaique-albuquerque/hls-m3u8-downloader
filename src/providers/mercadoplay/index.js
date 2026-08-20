import { fetchPlaylistText } from '../../hls.js';
import { hlsProvider } from '../hls/index.js';
import { dashProvider } from '../dash/index.js';
import { normalizeHeaders, DEFAULT_USER_AGENT } from '../../utils.js';

const PLAYLIST_VARIATIONS = [
  'index.m3u8',
  'master.m3u8',
  'playlist.m3u8',
  'stream.m3u8',
];

function isMercadoPlayUrl(url) {
  return /(?:^|[/.:])play\.mlstatic\.com\//i.test(String(url || ''));
}

async function findPlaylistUrl(baseUrl, headers = {}, onLog = () => {}) {
  const base = baseUrl.replace(/\/index_(audio|video)_\d+_\d+_\d+\.mp4$/i, '');
  const playHeaders = normalizeHeaders({
    'User-Agent': DEFAULT_USER_AGENT,
    'Referer': 'https://play.mercadolibre.com.br/',
    ...headers,
  });

  for (const variant of PLAYLIST_VARIATIONS) {
    const playlistUrl = `${base}/${variant}`;
    try {
      onLog?.(`[mercadoplay] Tentando ${variant}...`);
      await fetchPlaylistText(playlistUrl, playHeaders, 5000);
      onLog?.(`[mercadoplay] Playlist encontrada: ${variant}`);
      return playlistUrl;
    } catch {
      onLog?.(`[mercadoplay] ${variant} nao encontrado`);
    }
  }

  onLog?.('[mercadoplay] Tentando DASH (.mpd)...');
  const dashUrl = `${base}/master.mpd`;
  try {
    const testRes = await fetch(dashUrl, { method: 'HEAD', headers: playHeaders, timeout: 5000 });
    if (testRes.ok) {
      onLog?.('[mercadoplay] Playlist DASH encontrada');
      return dashUrl;
    }
  } catch {
    onLog?.('[mercadoplay] DASH nao encontrado');
  }

  onLog?.('[mercadoplay] Nenhuma playlist encontrada. Tentando conversao padrao.');
  return `${base}/index.m3u8`;
}

function convertToPlaylistUrl(url) {
  const s = String(url || '');
  if (/\/index_(audio|video)_\d+_\d+_\d+\.mp4$/i.test(s)) {
    return s.replace(/\/index_(audio|video)_\d+_\d+_\d+\.mp4$/i, '/index.m3u8');
  }
  if (s.endsWith('.m3u8') || s.endsWith('.mpd')) return s;
  if (s.endsWith('.mp4')) return s.replace(/\.mp4$/, '.m3u8');
  return s;
}

export const mercadoPlayProvider = {
  id: 'mercadoplay',
  label: 'Mercado Play',
  priority: 95,
  supportsQualitySelection: true,

  detect(url) {
    return isMercadoPlayUrl(url);
  },

  async analyze({ url, headers, onLog }) {
    const logFn = onLog || (() => {});
    let playlistUrl;
    try {
      playlistUrl = await findPlaylistUrl(url, headers, logFn);
    } catch (err) {
      logFn?.(`[mercadoplay] Erro ao procurar playlist: ${err?.message}`);
      playlistUrl = convertToPlaylistUrl(url);
    }

    if (playlistUrl.endsWith('.mpd')) {
      return dashProvider.analyze({ url: playlistUrl, headers });
    }

    try {
      return await hlsProvider.analyze({ url: playlistUrl, headers });
    } catch (err) {
      logFn?.(`[mercadoplay] Erro HLS: ${err?.message}`);
      if (playlistUrl.endsWith('.m3u8')) {
        const dashUrl = playlistUrl.replace(/\.m3u8$/, '.mpd');
        return dashProvider.analyze({ url: dashUrl, headers });
      }
      throw err;
    }
  },

  getFormats(media) {
    if (media.sourceType === 'dash') {
      return dashProvider.getFormats(media);
    }
    return hlsProvider.getFormats(media);
  },

  async prepareDownload({ url, selectedUrl, headers, auth, audioLanguage, allAudio }) {
    const playlistUrl = convertToPlaylistUrl(url);
    const selectedPlaylistUrl = selectedUrl ? convertToPlaylistUrl(selectedUrl) : undefined;

    if (playlistUrl.endsWith('.mpd')) {
      return dashProvider.prepareDownload({
        url: playlistUrl,
        selectedUrl: selectedPlaylistUrl,
        headers,
        auth,
        audioLanguage,
        allAudio,
      });
    }

    return hlsProvider.prepareDownload({
      url: playlistUrl,
      selectedUrl: selectedPlaylistUrl,
      headers,
      auth,
      audioLanguage,
      allAudio,
    });
  },
};
