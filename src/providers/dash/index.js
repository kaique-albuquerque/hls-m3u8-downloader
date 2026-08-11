/**
 * P3 — Provider DASH normalizado (src/providers/dash/index.js)
 *
 * Envolve src/dash.js (fetch + parse de MPD) e detecta DRM (<ContentProtection>)
 * com erro claro, sem contornar Widevine/PlayReady.
 *
 * Regra crítica da P3: NÃO reinventa o download DASH. Analyze → MediaInfo →
 * Formats → PreparedDownload { downloadUrl } → mecanismo atual (FFmpeg).
 *
 * O `kind` é 'dash' e os campos legados `representations` /
 * `videoRepresentations` / `baseUrl` são preservados (consumidores legados,
 * como o Electron, dependem deles).
 */

import { detectSourceType } from '../../utils.js';
import { fetchDashManifestText, parseDashManifest } from '../../dash.js';
import { createMediaInfo, createFormat } from '../../core/models.js';
import { checkDashDrm } from './drm.js';

export const dashProvider = {
  id: 'dash',
  label: 'DASH (.mpd)',
  priority: 80,
  supportsQualitySelection: false,

  /** Detecta URLs DASH (.mpd). */
  detect(url) {
    return detectSourceType(url) === 'dash';
  },

  /**
   * Analisa o manifesto DASH: busca o texto, verifica DRM e normaliza em
   * MediaInfo (preservando o shape legado de representações).
   */
  async analyze({ url, headers }) {
    const { text, url: finalUrl } = await fetchDashManifestText(url, headers);
    checkDashDrm(text);
    const parsed = parseDashManifest(text, finalUrl || url);
    return {
      ...createMediaInfo({
        kind: 'dash',
        sourceType: 'dash',
        provider: 'dash',
        title: '',
        variants: [],
      }),
      // Compatibilidade legada (Electron/cli): representações + base.
      baseUrl: parsed.baseUrl || '',
      representations: parsed.representations,
      videoRepresentations: parsed.videoRepresentations,
    };
  },

  /** Converte as representações de vídeo em Format[] normalizado. */
  getFormats(media) {
    return (media.videoRepresentations || []).map((r) =>
      createFormat({
        formatId: String(r.id || `dash-${r.height || r.bandwidth || 'video'}`),
        url: r.baseUrl,
        resolution: r.resolution,
        bandwidth: r.bandwidth,
        codecs: r.codecs,
        width: r.width,
        height: r.height,
        container: 'mp4',
        hasVideo: true,
        hasAudio: false,
      })
    );
  },

  /** O download DASH segue pelo mecanismo atual (FFmpeg recebe a URL). */
  async prepareDownload({ url }) {
    return { downloadUrl: url };
  },
};
