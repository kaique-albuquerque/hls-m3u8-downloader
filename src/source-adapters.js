/**
 * Fachada de compatibilidade sobre o ProviderRegistry (P3).
 *
 * A API legada (resolveSourceAdapter / resolveSourceAdapterAsync → adapters
 * com { id, label, supportsQualitySelection, analyze, prepareDownload }) é
 * preservada para consumidores existentes (CLI, engine, Electron, testes).
 *
 * Internamente, a detecção agora delega ao registry de providers:
 *   - youtube/social  → provider ytdlp
 *   - hls (incl. mdstrm) → provider hls
 *   - dash             → provider dash
 *   - direct           → provider direct
 *   - desconhecida     → probe de Content-Type (URLs sem extensão vira direta
 *                        quando o servidor responder video/* ou audio/*)
 */

import { isYouTubeUrl } from './utils.js';
import { createDefaultProviderRegistry } from './providers/registry.js';

const registry = createDefaultProviderRegistry();

/** Rótulos legados mantidos pela fachada (os providers têm rótulos próprios). */
const LEGACY_LABELS = {
  youtube: 'YouTube (yt-dlp)',
  social: 'Redes sociais (yt-dlp)',
  hls: 'HLS (.m3u8)',
  dash: 'DASH (.mpd)',
  direct: 'midia direta',
  unknown: 'desconhecido',
};

const UNKNOWN_ADAPTER = {
  id: 'unknown',
  label: LEGACY_LABELS.unknown,
  supportsQualitySelection: false,
  async analyze() {
    const err = new Error('Fonte nao suportada.');
    err.code = 'UNSUPPORTED_SOURCE';
    throw err;
  },
  async prepareDownload() {
    const err = new Error('Fonte nao suportada.');
    err.code = 'UNSUPPORTED_SOURCE';
    throw err;
  },
};

/** Mapeia o provider de volta ao id legado da fachada. */
function legacyAdapterId(provider, url) {
  if (provider.id === 'ytdlp') return isYouTubeUrl(url) ? 'youtube' : 'social';
  return provider.id;
}

/** Converte um provider em um adapter no shape legado. */
function toAdapter(provider, url) {
  if (!provider) return UNKNOWN_ADAPTER;
  const id = legacyAdapterId(provider, url);
  return {
    id,
    label: LEGACY_LABELS[id] || provider.label,
    supportsQualitySelection: provider.supportsQualitySelection ?? false,
    analyze: (params) => provider.analyze(params),
    prepareDownload: (params) => provider.prepareDownload(params),
  };
}

export function resolveSourceAdapter(url, opts) {
  return toAdapter(registry.detect(url, opts), url);
}

/**
 * Como resolveSourceAdapter, mas quando a URL não tem extensão reconhecida
 * faz um probe de content-type no servidor: se responder video/* ou audio/*,
 * trata como mídia direta (ex.: https://embed-api.clickhost.xyz/embed/stream/...).
 */
export async function resolveSourceAdapterAsync(url, headers = {}, opts = {}) {
  const { provider, detectedContentType } = await registry.detectAsync(url, { headers, ...opts });
  if (!provider) return UNKNOWN_ADAPTER;
  const adapter = toAdapter(provider, url);
  if (detectedContentType) adapter.detectedContentType = detectedContentType;
  return adapter;
}
