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
import { detectWidevine } from '../../drm/widevine.js';

const PLAYLIST_VARIATIONS = [
  'index.m3u8',
  'master.m3u8',
  'playlist.m3u8',
  'stream.m3u8',
];

/** Detecta URLs de Mercado Play (play.mlstatic.com). */
function isMercadoPlayUrl(url) {
  return /(?:^|[/.:])play\.mlstatic\.com\//i.test(String(url || ''));
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

/**
 * Anexa detecção de DRM ao resultado do analyze (HLS/DASH).
 * O provider atual lança UnsupportedDrmError para Widevine/PlayReady; aqui
 * capturamos e devolvemos as informações de DRM em `media.drm` para que o
 * pipeline de bypass (src/drm/) possa atuar.
 */
async function withDrmInfo(media, playlistUrl, headers, logFn = () => {}) {
  let drm = null;
  try {
    const { text } = await fetchPlaylistText(playlistUrl, headers);
    const detected = detectWidevine(text);
    if (detected?.hasDrm) {
      drm = {
        type: detected.method === 'clearkey' ? 'clearkey' : 'widevine',
        hasDRM: true,
        pssh: detected.pssh,
        kid: detected.kid,
      };
    }
  } catch {
    // Sem DRM ou manifesto inacessível — segue sem info de DRM.
  }
  return drm ? { ...media, drm } : media;
}

/**
 * Converte um UnsupportedDrmError (lançado pelo provider HLS/DASH) em um
 * MediaInfo com `drm` anotado — o conteúdo protegido passa a ser analisável
 * pelo pipeline de bypass. Retorna null para erros que não são de DRM.
 */
async function handleDrmAnalyzeError(err, playlistUrl, headers, logFn = () => {}) {
  if (err?.code !== 'UNSUPPORTED_DRM_ERROR') return null;
  logFn?.('[mercadoplay] DRM detectado pelo provider — coletando info para bypass');
  try {
    const { text } = await fetchPlaylistText(playlistUrl, headers);
    const detected = detectWidevine(text);
    return {
      kind: 'drm',
      sourceType: playlistUrl.endsWith('.mpd') ? 'dash' : 'hls',
      provider: 'mercadoplay',
      title: '',
      variants: [],
      drm: detected?.hasDrm
        ? {
            type: detected.method === 'clearkey' ? 'clearkey' : 'widevine',
            hasDRM: true,
            pssh: detected.pssh,
            kid: detected.kid,
          }
        : { type: 'unknown', hasDRM: true, pssh: null, kid: null },
    };
  } catch {
    return {
      kind: 'drm',
      sourceType: playlistUrl.endsWith('.mpd') ? 'dash' : 'hls',
      provider: 'mercadoplay',
      title: '',
      variants: [],
      drm: { type: 'unknown', hasDRM: true, pssh: null, kid: null },
    };
  }
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
   * Conteúdo protegido (Widevine/PlayReady) é sinalizado em `drm` em vez de
   * lançar erro — o pipeline DRM (src/drm/) decide como prosseguir.
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
      try {
        return withDrmInfo(
          await dashProvider.analyze({ url: playlistUrl, headers }),
          playlistUrl,
          headers,
          logFn
        );
      } catch (err) {
        return handleDrmAnalyzeError(err, playlistUrl, headers, logFn);
      }
    }
    
    // Senão, trata como HLS
    try {
      logFn?.(`[mercadoplay] Analisando como HLS: ${playlistUrl}`);
      return withDrmInfo(
        await hlsProvider.analyze({ url: playlistUrl, headers }),
        playlistUrl,
        headers,
        logFn
      );
    } catch (err) {
      const drmMedia = handleDrmAnalyzeError(err, playlistUrl, headers, logFn);
      if (drmMedia) return drmMedia;
      logFn?.(`[mercadoplay] Erro HLS: ${err?.message}`);
      // Se HLS falhar, tenta DASH como fallback
      if (playlistUrl.includes('.m3u8')) {
        const dashUrl = playlistUrl.replace(/\.m3u8$/, '.mpd');
        try {
          logFn?.('[mercadoplay] Tentando DASH como fallback');
          return withDrmInfo(
            await dashProvider.analyze({ url: dashUrl, headers }),
            dashUrl,
            headers,
            logFn
          );
        } catch (dashErr) {
          const dashDrm = handleDrmAnalyzeError(dashErr, dashUrl, headers, logFn);
          if (dashDrm) return dashDrm;
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
