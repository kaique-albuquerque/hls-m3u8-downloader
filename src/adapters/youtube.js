import { ytdlpProvider } from '../providers/ytdlp/index.js';

/**
 * Seletor do provider ytdlp para YouTube (P3).
 *
 * Mantém o contrato de adaptador legado ({ id, label, supportsQualitySelection,
 * analyze, prepareDownload }) para compatibilidade; a detecção/analise real
 * vive no ProviderRegistry (src/providers/registry.js).
 */
export const YOUTUBE_ADAPTER = {
  id: 'youtube',
  label: 'YouTube (yt-dlp)',
  supportsQualitySelection: true,
  analyze: (params) => ytdlpProvider.analyze(params),
  prepareDownload: (params) => ytdlpProvider.prepareDownload(params),
};
