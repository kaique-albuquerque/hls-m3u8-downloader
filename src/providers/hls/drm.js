/**
 * P3 — Detecção de DRM em HLS (src/providers/hls/drm.js)
 *
 * Apenas criptografia AES-128 (chave via #EXT-X-KEY) e METHOD=NONE são
 * suportadas pelo fluxo atual. Esquemas de amostra (SAMPLE-AES/CTR) e
 * KEYFORMAT de DRM comercial (FairPlay, Widevine, PlayReady) indicam
 * conteúdo protegido: retornamos erro claro (UnsupportedDrmError) SEM
 * tentar contornar.
 *
 * P11 (ajuste): a tag #EXT-X-SESSION-KEY não é mais bloqueada apenas por
 * existir — ela usa a mesma sintaxe de atributos de #EXT-X-KEY e pode
 * aparecer legitimamente com METHOD=AES-128/KEYFORMAT=identity (a chave é
 * pré-declarada no master, mas a criptografia continua sendo AES-128, que o
 * fluxo atual suporta). Bloqueamos apenas quando METHOD ou KEYFORMAT
 * indicam um esquema realmente não suportado.
 */

import { UnsupportedDrmError } from '../../core/errors.js';

/** METHODS de #EXT-X-KEY fora de NONE/AES-128 indicam criptografia de amostra/DRM. */
const KEY_METHOD_RE = /METHOD\s*=\s*"?([A-Za-z0-9-]+)"?/i;
const KEYFORMAT_RE = /KEYFORMAT\s*=\s*"([^"]+)"/i;

/** Extrai METHOD/KEYFORMAT de uma linha #EXT-X-KEY/#EXT-X-SESSION-KEY. */
function parseKeyLine(line) {
  const method = String(KEY_METHOD_RE.exec(line)?.[1] || '').toUpperCase();
  const keyformat = String(KEYFORMAT_RE.exec(line)?.[1] || '').toLowerCase();
  return { method, keyformat };
}

/** True apenas para criptografia suportada: NONE/AES-128 com KEYFORMAT identity/ausente. */
function isSupportedEncryption({ method, keyformat }) {
  if (method && method !== 'NONE' && method !== 'AES-128') return false;
  if (keyformat && keyformat !== 'identity') return false;
  return true;
}

/** Monta o detalhe legível do esquema detectado (para o erro sem bypass). */
function describeScheme({ method, keyformat }) {
  const parts = [];
  if (method) parts.push(`METHOD=${method}`);
  if (keyformat) parts.push(`KEYFORMAT="${keyformat}"`);
  return parts.join(', ');
}

/**
 * Verifica o texto de uma playlist HLS (master ou media) e lança
 * UnsupportedDrmError se detectar criptografia não suportada.
 *
 * Regras (P11):
 *  - #EXT-X-KEY e #EXT-X-SESSION-KEY passam quando METHOD é NONE/AES-128
 *    (ou ausente) E KEYFORMAT é identity/ausente;
 *  - qualquer outro METHOD (SAMPLE-AES, SAMPLE-AES-CTR, ...) ou KEYFORMAT
 *    de DRM comercial (com.apple.streamingkeydelivery, Widevine, PlayReady)
 *    lança UnsupportedDrmError.
 *
 * Retorna false quando o texto não tem DRM (ou usa apenas AES-128/NONE).
 */
export function checkHlsDrm(text) {
  const s = String(text || '');

  // #EXT-X-SESSION-KEY (master) e #EXT-X-KEY (media): mesma verificação.
  for (const match of s.matchAll(/#EXT-X-(?:SESSION-)?KEY[:\s]*([^\r\n]*)/gi)) {
    const scheme = parseKeyLine(match[1]);
    if (!isSupportedEncryption(scheme)) {
      const desc = describeScheme(scheme) || 'criptografia não identificada';
      const tag = match[0].startsWith('#EXT-X-SESSION-KEY') ? '#EXT-X-SESSION-KEY' : '#EXT-X-KEY';
      throw new UnsupportedDrmError(
        `A playlist usa criptografia ${desc} (DRM), que não é suportada.`,
        {
          detail:
            `${tag} com ${desc} — apenas NONE e AES-128 (KEYFORMAT identity) são suportados; ` +
            'SAMPLE-AES/FairPlay/Widevine/PlayReady não são contornados.',
        }
      );
    }
  }

  return false;
}
