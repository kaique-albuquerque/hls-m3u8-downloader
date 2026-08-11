/**
 * P3 — Provider de mídia direta (src/providers/direct/index.js)
 *
 * Arquivos de mídia servidos por URL direta (extensões conhecidas, URLs de
 * playback do Google, ou Content-Type de mídia detectado por probe).
 *
 * Analyze não toca a rede: qualquer URL direta é analisável por definição.
 * O download segue pelo mecanismo atual (stream direto / turbo).
 */

import { detectSourceType } from '../../utils.js';
import { createMediaInfo } from '../../core/models.js';

export const directProvider = {
  id: 'direct',
  label: 'Midia direta',
  priority: 70,
  supportsQualitySelection: false,

  /** Detecta URLs de mídia direta (extensão/URL de playback conhecida). */
  detect(url) {
    return detectSourceType(url) === 'direct';
  },

  /** Mídia direta não exige análise prévia. */
  async analyze() {
    return createMediaInfo({
      kind: 'direct',
      sourceType: 'direct',
      provider: 'direct',
      title: '',
      variants: [],
    });
  },

  /** Sem formatos selecionáveis — o download usa a própria URL. */
  getFormats() {
    return [];
  },

  async prepareDownload({ url }) {
    return { downloadUrl: url };
  },
};
