/**
 * P3 — ProviderRegistry (src/providers/registry.js)
 *
 * Registro central de providers por prioridade. A resolução começa pelos
 * providers de maior prioridade (yt-dlp > HLS > DASH > direto) e, para URLs
 * desconhecidas, faz um probe HTTP do Content-Type para decidir se a mídia é
 * direta (mesma estratégia do fluxo legado).
 *
 * Contrato de Provider (plano, seção 5):
 *   { id, label, priority, detect(input, opts): boolean,
 *     analyze(input, context): Promise<MediaInfo>,
 *     getFormats(media): Format[],
 *     prepareDownload(selection, context): Promise<PreparedDownload> }
 */

import { probeMediaContentType, isDirectMediaContentType } from '../utils.js';
import { ytdlpProvider } from './ytdlp/index.js';
import { hlsProvider } from './hls/index.js';
import { dashProvider } from './dash/index.js';
import { directProvider } from './direct/index.js';
import { mercadoPlayProvider } from './mercadoplay/index.js';

export class ProviderRegistry {
  constructor() {
    /** @type {Array<import('../core/models.js').Provider>} */
    this._providers = [];
  }

  /**
   * Registra um provider (ordenado por `priority`, do maior para o menor).
   * Lança se já existir um provider com o mesmo id.
   */
  register(provider) {
    if (this.get(provider.id)) {
      throw new Error(`Provider duplicado: ${provider.id}`);
    }
    this._providers.push(provider);
    this._providers.sort((a, b) => b.priority - a.priority);
    return this;
  }

  /** Retorna o provider registrado com o id informado (ou null). */
  get(id) {
    return this._providers.find((p) => p.id === id) || null;
  }

  /** Lista de providers registrados, em ordem de prioridade. */
  list() {
    return [...this._providers];
  }

  /**
   * Detecta o provider de uma URL sem tocar a rede.
   * Um detector que lançar nunca derruba o registry (outros providers são
   * tentados em seguida).
   */
  detect(url, opts = {}) {
    for (const provider of this._providers) {
      try {
        if (provider.detect(url, opts)) return provider;
      } catch {
        // Detector com defeito não impede os demais.
      }
    }
    return null;
  }

  /**
   * Detecta o provider de uma URL fazendo probe HTTP do Content-Type quando
   * a URL é desconhecida (nem HLS/DASH/yt-dlp/direto por extensão).
   *
   * Retorna { provider, detectedContentType } — detectedContentType é '' quando
   * o provider foi resolvido sem probe.
   */
  async detectAsync(url, { headers = {}, ...opts } = {}) {
    const provider = this.detect(url, opts);
    if (provider) return { provider, detectedContentType: '' };

    const contentType = await probeMediaContentType(url, headers);
    if (contentType && isDirectMediaContentType(contentType)) {
      return { provider: this.get('direct'), detectedContentType: contentType };
    }
    return { provider: null, detectedContentType: contentType || '' };
  }
}

/**
 * Registry padrão do StreamGrab com os providers embutidos.
 * A ordem de registro é irrelevante — a prioridade define a resolução.
 */
export function createDefaultProviderRegistry() {
  return new ProviderRegistry()
    .register(ytdlpProvider)
    .register(mercadoPlayProvider)
    .register(hlsProvider)
    .register(dashProvider)
    .register(directProvider);
}
