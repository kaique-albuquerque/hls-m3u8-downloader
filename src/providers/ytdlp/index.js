/**
 * P3 — Provider yt-dlp normalizado (src/providers/ytdlp/index.js)
 *
 * Migra a lógica de src/adapters/ytdlp.js para o contrato de Provider:
 * YouTube, redes sociais e qualquer plataforma coberta pelo yt-dlp.
 *
 * O JSON cru do yt-dlp é normalizado em MediaInfo/Format (via
 * core/models.js) — nenhum shape cru (format_id numérico, campos internos)
 * vaza para consumidores do provider.
 */

import { isYouTubeUrl, isSocialMediaUrl } from '../../utils.js';
import { analyzeYtDlpUrl, prepareYtDlpDownload } from '../../adapters/ytdlp.js';
import { createMediaInfo, createFormat } from '../../core/models.js';

export const ytdlpProvider = {
  id: 'ytdlp',
  label: 'yt-dlp (YouTube e redes sociais)',
  priority: 100,
  supportsQualitySelection: true,

  /**
   * Detecta YouTube e redes sociais. Com forceYouTube, apenas YouTube
   * (compatível com o modo --youtube da CLI/engine).
   */
  detect(url, { forceYouTube = false } = {}) {
    if (forceYouTube) return isYouTubeUrl(url);
    return isYouTubeUrl(url) || isSocialMediaUrl(url);
  },

  /** Analisa a URL com yt-dlp e normaliza o resultado em MediaInfo. */
  async analyze({ url, headers, auth }) {
    const raw = await analyzeYtDlpUrl(url, headers, auth);
    return createMediaInfo({
      ...raw,
      sourceType: 'ytdlp',
      provider: 'ytdlp',
    });
  },

  /** Converte os formatos já normalizados do MediaInfo em Format[]. */
  getFormats(media) {
    return (media.formats || []).map((f) => createFormat(f));
  },

  /** Download: mux (adaptativo) ou único (progressivo) — mecanismo atual. */
  prepareDownload(params) {
    return prepareYtDlpDownload(params);
  },
};
