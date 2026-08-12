/**
 * P6.1 — Sessao de resume (secao 13 do architect.md).
 *
 * Decide, antes de (re)iniciar um download por partes, o que fazer com o
 * estado persistido:
 *  - `fresh`   — sem estado anterior (ou URL renovada sem estado): baixa tudo.
 *  - `resume`  — validators coincidem: retoma apenas os chunks pendentes.
 *  - `discard` — recurso mudou (ETag/Last-Modified/tamanho): descarta o
 *                parcial e recomeca limpo (NUNCA concatena dados antigos).
 *  - `error`   — o probe falhou sem possibilidade de renovacao: propaga.
 *
 * URL assinada expirada (maior armadilha do resume, risco alto no plano):
 * quando o probe falha com 403/EXPIRED_URL, tenta UMA reanalise via
 * `resolveFreshUrl` para obter uma URL fresca; apos renovar, re-probe e
 * re-valida o estado contra o recurso renovado. Nunca entra em loop:
 * no maximo uma reanalise por sessao, e a URL precisa ser diferente.
 */

import { validateState } from './resume.js';

/** Erros que indicam URL assinada expirada (403 classico de CDN assinado). */
export function isExpiredUrlError(err) {
  const code = String(err?.code || '');
  return code === 'FORBIDDEN_ERROR' || code === 'EXPIRED_URL' || code === 'EXPIRED_URL_ERROR';
}

/**
 * Decide a acao de resume.
 *
 * @param {object} params
 * @param {object|null} params.state — DownloadState carregado (ou null).
 * @param {string} params.url — URL atual.
 * @param {object} [params.headers]
 * @param {object|null} [params.probe] — resultado do probe `{ total, etag, lastModified }`
 *   (null quando o probe falhou).
 * @param {Error|null} [params.probeError] — erro do probe (quando falhou).
 * @param {Function} [params.resolveFreshUrl] — reanalise: `async ({ url, headers }) => ({ url })`.
 * @param {Function} [params.probeRange] — re-probe com URL renovada: `(url) => Promise<probe>`.
 * @param {Function} [params.onReanalyze] — callback informativo `(info) => void`.
 * @returns {Promise<{action: 'fresh'|'resume'|'discard'|'error', url?: string,
 *   probe?: object, state?: object|null, error?: Error, reason: string, code?: string}>}
 */
export async function resolveResumeSession({
  state,
  url,
  headers = {},
  probe = null,
  probeError = null,
  resolveFreshUrl,
  probeRange,
  onReanalyze,
} = {}) {
  // 1) Probe falhou -> possivel URL assinada expirada -> UMA reanalise.
  if (probeError) {
    if (resolveFreshUrl && isExpiredUrlError(probeError)) {
      const fresh = await resolveFreshUrl({ url, headers });
      if (fresh?.url && fresh.url !== url && typeof fresh.url === 'string') {
        onReanalyze?.({ reason: probeError.message });
        const freshProbe = probeRange ? await probeRange(fresh.url) : null;
        if (state && freshProbe) {
          const v = validateState(state, freshProbe);
          if (v.ok) {
            return { action: 'resume', url: fresh.url, probe: freshProbe, state, reason: 'URL renovada por reanalise; validators coincidem' };
          }
          return { action: 'discard', url: fresh.url, probe: freshProbe, state, reason: v.reason, code: v.code };
        }
        return { action: 'fresh', url: fresh.url, probe: freshProbe, state, reason: 'URL renovada por reanalise; sem estado valido' };
      }
    }
    return { action: 'error', url, probe, state, error: probeError, reason: probeError.message };
  }

  // 2) Sem estado anterior -> download limpo.
  if (!state) {
    return { action: 'fresh', url, probe, state: null, reason: 'sem estado anterior' };
  }

  // 3) Estado existe -> valida contra o probe atual.
  const v = validateState(state, probe || {});
  if (v.ok) {
    return { action: 'resume', url, probe, state, reason: 'validators coincidem' };
  }
  return { action: 'discard', url, probe, state, reason: v.reason, code: v.code };
}

export default { resolveResumeSession, isExpiredUrlError };
