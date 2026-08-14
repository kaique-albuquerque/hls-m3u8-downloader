/**
 * P3 — Provider Mercado Play (src/providers/mercadoplay/index.js)
 *
 * Bypass para Mercado Play (play.mlstatic.com).
 *
 * URLs de segmentos mdstrm copiadas do DevTools vêm como:
 *   https://video-mpkg-msm-01-vod.play.mlstatic.com/.../index_audio_7_0_107.mp4
 *   https://video-mpkg-msm-01-vod.play.mlstatic.com/.../index_video_3_0_107.mp4
 *
 * Essas são apenas fragmentos de um stream HLS. O bypass tenta converter para playlist:
 *   1. .../index.m3u8 (padrão HLS)
 *   2. .../master.m3u8 (variação comum)
 *   3. .../playlist.m3u8 (outra variação)
 *   4. .../stream.m3u8 (outra variação)
 *
 * Se playlist não existir no caminho esperado, sugerimos ao usuário copiar a URL correta.
 * Se curl-impersonate estiver instalado, usa TLS de navegador para contornar bloqueios.
 */

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

/** Detecta URLs de Mercado Play (play.mlstatic.com). */
function isMercadoPlayUrl(url) {
  return /(?:^|\.)play\.mlstatic\.com\//i.test(String(url || ''));
}

/** Tenta encontrar a playlist correta testando múltiplas variações. */
async function findPlaylistUrl(baseUrl, headers = {}, onLog = () => {}) {
  const base = baseUrl.replace(/\/index_(audio|video)_\d+_\d+_\d+\.mp4$/i, '');
  
  // Headers especiais para Mercado Play (pode exigir Referer, etc)
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
      // Se não lançou erro, a playlist existe
      onLog?.(`[mercadoplay] ✓ Playlist encontrada: ${variant}`);
      return playlistUrl;
    } catch (err) {
      onLog?.(`[mercadoplay] ✗ ${variant} não encontrado`);
      // Tenta próxima variação
      continue;
    }
  }

  // Se nenhuma variação funcionou, tenta com .mpd (DASH)
  onLog?.('[mercadoplay] Tentando DASH (.mpd)...');
  const dashUrl = `${base}/master.mpd`;
  try {
    // Tenta fetch simples para verificar existência
    const testRes = await fetch(dashUrl, { method: 'HEAD', headers: playHeaders, timeout: 5000 });
    if (testRes.ok) {
      onLog?.(`[mercadoplay] ✓ Playlist DASH encontrada`);
      return dashUrl;
    }
  } catch {
    onLog?.('[mercadoplay] ✗ DASH não encontrado');
  }

  // Fallback: retorna a conversão padrão mesmo que 404
  // (pode ter sucesso com curl-impersonate no FFmpeg ou outro cliente)
  onLog?.('[mercadoplay] ⚠ Nenhuma playlist encontrada. Tentando com conversão padrão...');
  onLog?.('[mercadoplay] DICA: Se o download ainda falhar, copie a URL correta do DevTools (Network → procure por .m3u8)');
  return `${base}/index.m3u8`;
}

/** Converte URL de segmento mdstrm para playlist HLS (versão rápida). */
function convertToPlaylistUrl(url) {
  const s = String(url || '');
  
  // Padrão: .../index_audio_N_M_K.mp4 ou .../index_video_N_M_K.mp4
  // Converte para: .../index.m3u8
  if (/\/index_(audio|video)_\d+_\d+_\d+\.mp4$/i.test(s)) {
    return s.replace(/\/index_(audio|video)_\d+_\d+_\d+\.mp4$/i, '/index.m3u8');
  }
  
  // Se já é .m3u8, retorna como está
  if (s.endsWith('.m3u8')) {
    return s;
  }
  
  // Se é .mpd (DASH), retorna como está
  if (s.endsWith('.mpd')) {
    return s;
  }
  
  // Fallback: tenta substituir qualquer .mp4 por .m3u8
  if (s.endsWith('.mp4')) {
    return s.replace(/\.mp4$/, '.m3u8');
  }
  
  return s;
}

export const mercadoPlayProvider = {
  id: 'mercadoplay',
  label: 'Mercado Play (bypass mdstrm)',
  priority: 95, // Antes de HLS (90) e Direct (70)
  supportsQualitySelection: true,

  /** Detecta URLs de Mercado Play. */
  detect(url) {
    return isMercadoPlayUrl(url);
  },

  /**
   * Analisa como HLS (após tentar encontrar a playlist correta).
   * Se a conversão resultar em .mpd, delega para DASH provider.
   */
  async analyze({ url, headers, onLog }) {
    const logFn = onLog || (() => {});
    
    // Tenta encontrar a URL correta da playlist
    let playlistUrl;
    try {
      playlistUrl = await findPlaylistUrl(url, headers, logFn);
    } catch (err) {
      logFn?.(` [mercadoplay] Erro ao procurar playlist: ${err?.message}`);
      // Se falhar, usa conversão padrão
      playlistUrl = convertToPlaylistUrl(url);
    }
    
    // Se converteu para DASH, delega
    if (playlistUrl.endsWith('.mpd')) {
      logFn?.('[mercadoplay] Delegando para DASH provider');
      return dashProvider.analyze({ url: playlistUrl, headers });
    }
    
    // Senão, trata como HLS
    try {
      logFn?.(`[mercadoplay] Analisando como HLS: ${playlistUrl}`);
      return await hlsProvider.analyze({ url: playlistUrl, headers });
    } catch (err) {
      logFn?.(`[mercadoplay] Erro HLS: ${err?.message}`);
      // Se HLS falhar, tenta DASH como fallback
      if (playlistUrl.includes('.m3u8')) {
        const dashUrl = playlistUrl.replace(/\.m3u8$/, '.mpd');
        try {
          logFn?.('[mercadoplay] Tentando DASH como fallback');
          return await dashProvider.analyze({ url: dashUrl, headers });
        } catch {
          // DASH também falhou, retorna erro original do HLS
          throw err;
        }
      }
      throw err;
    }
  },

  /** Delega getFormats para HLS ou DASH. */
  getFormats(media) {
    if (media.sourceType === 'dash') {
      return dashProvider.getFormats(media);
    }
    return hlsProvider.getFormats(media);
  },

  /**
   * Prepara download via HLS ou DASH provider.
   * Re-converte a URL se necessário.
   */
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
