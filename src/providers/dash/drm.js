/**
 * P3 — Detecção de DRM em DASH (src/providers/dash/drm.js)
 *
 * Qualquer <ContentProtection> no MPD (Widevine, PlayReady, FairPlay, cenc,
 * ClearKey) indica conteúdo protegido: retornamos erro claro (UnsupportedDrmError)
 * SEM tentar contornar Widevine/PlayReady.
 */

import { UnsupportedDrmError } from '../../core/errors.js';

/** UUIDs conhecidos de DRM no atributo schemeIdUri de <ContentProtection>. */
const DRM_SCHEMES = [
  { name: 'Widevine', re: /edef8ba9-79d6-4ace-a3c8-27dcd51d21ed/i },
  { name: 'PlayReady', re: /9a04f079-9840-4286-ab92-e65be0885f95/i },
  { name: 'FairPlay', re: /94ce86fb-07ff-4f43-adb8-93d2fa968ca2/i },
];

/** schemeIdUri mpeg cenc (mp4protection) com value cenc/cbcs. */
const CENC_SCHEME = /urn:mpeg:dash:mp4protection:2011/i;

const CONTENT_PROTECTION_RE = /<ContentProtection\b[^>]*>/gi;

/**
 * Verifica o texto de um MPD e lança UnsupportedDrmError se detectar DRM.
 * Retorna false quando o manifesto não tem proteção de conteúdo.
 */
export function checkDashDrm(text) {
  const s = String(text || '');

  for (const match of s.matchAll(CONTENT_PROTECTION_RE)) {
    const tag = match[0];
    const scheme = /schemeIdUri\s*=\s*"([^"]+)"/i.exec(tag)?.[1] || '';
    const value = /value\s*=\s*"([^"]+)"/i.exec(tag)?.[1] || '';

    const known = DRM_SCHEMES.find(({ re }) => re.test(scheme));
    const cenc = CENC_SCHEME.test(scheme);
    const protectedValue = /cenc|cbcs/i.test(value);

    if (known || (cenc && protectedValue)) {
      throw new UnsupportedDrmError(
        `O manifesto DASH usa proteção de conteúdo (DRM: ${known?.name || 'cenc'}). StreamGrab não suporta conteúdo protegido por DRM.`,
        { detail: `<ContentProtection schemeIdUri="${scheme}"${value ? ` value="${value}"` : ''}>` }
      );
    }
  }

  return false;
}
