/**
 * Shared helpers for mdstrm URL routing.
 *
 * Extracts the duplicated patterns across engine.js, cli/curl-flow.js,
 * and electron/main.js:
 *  - resolveTransportWithAutoInstall: resolve curl-impersonate → auto-install → retry
 *  - safeRefreshMdstrm: detect → refresh → fallback silently
 *
 * Each caller retains its own download/analysis logic (too different to merge),
 * but the plumbing is now in one place.
 */

import { installCurlImpersonate } from '../curlimp-install.js';
import { CurlImpersonateTransport } from '../transports/curl.js';
import { isMdstrmUrl, needsMdstrmRefresh, extractMdstrmVideoId, refreshMdstrmUrl } from '../mdstrm.js';

/**
 * Resolve o transporte curl-impersonate, tentando instalacao automatica
 * se ausente. Retorna o transport ou null.
 *
 * @param {object} opts
 * @param {object} [opts.headers] — headers HTTP autorizados.
 * @param {string} [opts.projectRoot] — raiz do projeto para instalacao.
 * @param {Function} [opts.onLog] — callback de log (opcional).
 * @returns {Promise<import('../transports/curl.js').CurlImpersonateTransport | null>}
 */
export async function resolveTransportWithAutoInstall({ headers = {}, projectRoot = process.cwd(), onLog = () => {} } = {}) {
  const transport = CurlImpersonateTransport.resolve({ headers });
  if (transport) return transport;

  onLog('[mdstrm] curl-impersonate ausente — tentando instalacao automatica');
  try {
    await installCurlImpersonate({
      projectRoot,
      io: { log: (message) => onLog(message) },
    });
  } catch {
    /* instalacao automatica falhou — transport continua null */
  }
  return CurlImpersonateTransport.resolve({ headers });
}

/**
 * Detecta URL mdstrm que precisa de refresh e converte para URL do player.
 * Se a URL nao for mdstrm, nao precisar de refresh, ou o refresh falhar,
 * retorna a URL original sem lancar excecao.
 *
 * @param {string} url — URL original.
 * @param {object} [client] — curl client para o refresh (opcional).
 * @param {Function} [onLog] — callback de log (opcional).
 * @returns {Promise<string>} URL do player (ou original se nao aplicavel).
 */
export async function safeRefreshMdstrm(url, client, onLog = () => {}) {
  if (!isMdstrmUrl(url) || !needsMdstrmRefresh(url)) return url;

  const videoId = extractMdstrmVideoId(url);
  if (!videoId) return url;

  try {
    const refreshed = await refreshMdstrmUrl(url, client);
    onLog(`[mdstrm] URL do player refreshada (videoId ${videoId})`);
    return refreshed;
  } catch {
    onLog(`[mdstrm] Refresh falhou — usando URL original (videoId ${videoId})`);
    return url;
  }
}
