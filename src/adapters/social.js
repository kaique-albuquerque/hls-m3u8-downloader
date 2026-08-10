import { analyzeYtDlpUrl, prepareYtDlpDownload } from './ytdlp.js';
import { socialLabelForUrl } from '../utils.js';

/**
 * Adaptador fino de redes sociais: Facebook, Instagram, TikTok, X/Twitter,
 * Reddit, Twitch, Vimeo, LinkedIn e outros sites suportados pelo yt-dlp.
 *
 * Reusa o mesmo motor yt-dlp generico do YouTube. Limitacoes conhecidas:
 * - Conteudo privado/autenticado exige cookies (future: carregar de config.json).
 * - Conteudo protegido por DRM nao pode ser baixado.
 * - Qualidade tipica fica <= 1080p em posts publicos.
 */
export const SOCIAL_ADAPTER = {
  id: 'social',
  label: 'Redes sociais (yt-dlp)',
  supportsQualitySelection: true,
  analyze: ({ url, headers }) => analyzeYtDlpUrl(url, headers),
  prepareDownload: (params) => prepareYtDlpDownload(params),
};

/** Rotulo legivel usado em mensagens (ex.: "Facebook", "TikTok"). */
export function socialLabel(url) {
  return socialLabelForUrl(url);
}
