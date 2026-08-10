import { analyzeYtDlpUrl, prepareYtDlpDownload } from './ytdlp.js';

/**
 * Adaptador fino de YouTube: delega todo o trabalho pesado ao motor yt-dlp
 * generico (src/adapters/ytdlp.js) mantendo o contrato de adaptador esperado
 * pelo CLI/Electron: { id, label, supportsQualitySelection, analyze, prepareDownload }.
 */
export const YOUTUBE_ADAPTER = {
  id: 'youtube',
  label: 'YouTube (yt-dlp)',
  supportsQualitySelection: true,
  analyze: ({ url, headers, auth }) => analyzeYtDlpUrl(url, headers, auth),
  prepareDownload: (params) => prepareYtDlpDownload(params),
};
