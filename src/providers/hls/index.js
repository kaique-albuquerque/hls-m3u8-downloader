/**
 * P3 — Provider HLS normalizado (src/providers/hls/index.js)
 *
 * Envolve src/hls.js (fetch + parse de playlists) e reconhece URLs da Media
 * Stream/mdstrm como HLS (a renovação da URL do player continua sendo
 * estratégia de download do curl-flow — fora do escopo desta parte).
 *
 * Regra crítica da P3: NÃO reinventa o download HLS. Analyze → MediaInfo →
 * Formats → PreparedDownload { downloadUrl } → mecanismo atual (FFmpeg).
 *
 * O `kind` do parse é preservado (master/media/unknown) porque consumidores
 * legados (Electron) dependem dele; o MediaInfo também carrega `baseUrl`
 * para resolução de URIs relativas.
 */

import { detectSourceType } from '../../utils.js';
import { isMdstrmUrl } from '../../mdstrm.js';
import { fetchPlaylistText, parsePlaylistText } from '../../hls.js';
import { createMediaInfo, createFormat } from '../../core/models.js';
import { checkHlsDrm } from './drm.js';

export const hlsProvider = {
  id: 'hls',
  label: 'HLS (.m3u8)',
  priority: 90,
  supportsQualitySelection: true,

  /** Detecta URLs HLS (.m3u8) e URLs da Media Stream (mdstrm). */
  detect(url) {
    return detectSourceType(url) === 'hls' || isMdstrmUrl(url);
  },

  /**
   * Analisa a playlist (master ou media): busca o texto, verifica DRM e
   * normaliza em MediaInfo. Para master, `variants` preserva o shape legado
   * ({ uri, resolution, width, height, bandwidth, codecs }).
   */
  async analyze({ url, headers }) {
    const { text, url: finalUrl } = await fetchPlaylistText(url, headers);
    checkHlsDrm(text);
    const parsed = parsePlaylistText(text, finalUrl || url);
    return {
      ...createMediaInfo({
        kind: parsed.kind,
        sourceType: 'hls',
        provider: 'hls',
        title: '',
        variants: parsed.variants,
      }),
      // Compatibilidade legada (Electron/cli): base para URIs relativas.
      baseUrl: parsed.baseUrl || '',
    };
  },

  /** Converte as variantes do master em Format[] normalizado. */
  getFormats(media) {
    return (media.variants || []).map((v, i) =>
      createFormat({
        formatId: `hls-${v.height || v.bandwidth || i + 1}`,
        url: v.uri,
        resolution: v.resolution,
        bandwidth: v.bandwidth,
        codecs: v.codecs,
        width: v.width,
        height: v.height,
        container: '',
        hasVideo: true,
        hasAudio: true,
      })
    );
  },

  /**
   * O download HLS segue pelo mecanismo atual (FFmpeg recebe a URL).
   * Quando a UI ja escolheu uma variante (selectedUrl absoluta), baixa a
   * variante escolhida; caso contrario, a URL original (master/media).
   */
  async prepareDownload({ url, selectedUrl }) {
    return { downloadUrl: selectedUrl || url };
  },
};
