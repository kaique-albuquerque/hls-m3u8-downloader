import { ytdlpProvider } from '../providers/ytdlp/index.js';
import { socialLabelForUrl } from '../utils.js';

/**
 * Seletor do provider ytdlp para redes sociais (P3): Facebook, Instagram,
 * TikTok, X/Twitter, Reddit, Twitch, Vimeo, LinkedIn e outros sites cobertos
 * pelo yt-dlp.
 *
 * Mantém o contrato de adaptador legado para compatibilidade; a detecção/
 * análise real vive no ProviderRegistry (src/providers/registry.js).
 *
 * Limitações conhecidas:
 * - Conteúdo privado/autenticado exige cookies (future: carregar de config.json).
 * - Conteúdo protegido por DRM não pode ser baixado.
 * - Qualidade típica fica <= 1080p em posts públicos.
 */
export const SOCIAL_ADAPTER = {
  id: 'social',
  label: 'Redes sociais (yt-dlp)',
  supportsQualitySelection: true,
  analyze: (params) => ytdlpProvider.analyze(params),
  prepareDownload: (params) => ytdlpProvider.prepareDownload(params),
};

/** Rotulo legivel usado em mensagens (ex.: "Facebook", "TikTok"). */
export function socialLabel(url) {
  return socialLabelForUrl(url);
}
