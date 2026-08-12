/**
 * P3 — Detecção de DRM em HLS (src/providers/hls/drm.js)
 *
 * Apenas criptografia AES-128 (chave via #EXT-X-KEY) e METHOD=NONE são
 * suportadas pelo fluxo atual. Qualquer outro esquema (SAMPLE-AES, FairPlay,
 * Widevine, PlayReady, sessão de chave no master) indica conteúdo protegido
 * por DRM: retornamos erro claro (UnsupportedDrmError) SEM tentar contornar.
 */

import { UnsupportedDrmError } from '../../core/errors.js';

/** METHODS de #EXT-X-KEY fora de NONE/AES-128 indicam criptografia de amostra/DRM. */
const KEY_METHOD_RE = /METHOD\s*=\s*"?([A-Za-z0-9-]+)"?/i;

/**
 * Verifica o texto de uma playlist HLS (master ou media) e lança
 * UnsupportedDrmError se detectar criptografia não suportada.
 *
 * Retorna false quando o texto não tem DRM (ou usa apenas AES-128/NONE).
 */
export function checkHlsDrm(text) {
  const s = String(text || '');

  // Sessão de chave no master (#EXT-X-SESSION-KEY) implica DRM.
  if (/#EXT-X-SESSION-KEY/gi.test(s)) {
    throw new UnsupportedDrmError(
      'A playlist usa criptografia de sessão (DRM). StreamGrab não suporta conteúdo protegido por DRM.',
      {
        detail:
          '#EXT-X-SESSION-KEY detectado na playlist master — esquemas típicos: ' +
          'FairPlay (skd://), Widevine ou PlayReady.',
      }
    );
  }

  // #EXT-X-KEY: apenas NONE (sem criptografia) e AES-128 (suportado) passam.
  for (const match of s.matchAll(/#EXT-X-KEY[:\s]*([^\r\n]*)/gi)) {
    const method = KEY_METHOD_RE.exec(match[1])?.[1];
    const upper = String(method || '').toUpperCase();
    if (upper && upper !== 'NONE' && upper !== 'AES-128') {
      throw new UnsupportedDrmError(
        `A playlist usa criptografia ${method || 'desconhecida'} (DRM), que não é suportada.`,
        {
          detail:
            `#EXT-X-KEY com METHOD=${method || '?'} — apenas NONE e AES-128 são suportados ` +
            '(SAMPLE-AES/FairPlay/Widevine/PlayReady não são contornados).',
        }
      );
    }
  }

  return false;
}
