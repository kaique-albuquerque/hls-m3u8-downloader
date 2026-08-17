/**
 * P1-DRM — Handler Mercado Play (src/drm/mercado-play.js)
 *
 * Handler específico do Mercado Play (play.mlstatic.com):
 *  - Detecta DRM (Widevine/PlayReady) em playlists HLS/DASH;
 *  - Adquire licença e descriptografa com WidevineHandler;
 *  - License server configurável (descoberto na Fase 0 do plano).
 *
 * O provider src/providers/mercadoplay/index.js continua responsável pela
 * conversão de URLs mdstrm → playlist; este handler entra quando a playlist
 * revela proteção de conteúdo.
 */

import { WidevineHandler, detectWidevine, CLEARKEY_UUID } from './widevine.js';
import { DrmLicenseError } from '../core/errors.js';

/**
 * URLs típicas de license server do Mercado Play. Confirmado na Fase 0
 * (2026-08-17): o license server real é o DRMtoday:
 *   https://lic.drmtoday.com/license-proxy-widevine/cenc/?specConform=true
 * A lista é tentada em ordem até uma responder; pode ser sobrescrita via
 * constructor ou --license-url no CLI.
 */
export const DEFAULT_LICENSE_CANDIDATES = [
  'https://lic.drmtoday.com/license-proxy-widevine/cenc/?specConform=true',
  'https://lic.drmtoday.com/license-proxy-widevine/cenc/',
  'https://play.mlstatic.com/license',
  'https://mp-license.mlstatic.com/widevine',
];

/** Detecta URLs de playlist do Mercado Play. */
export function isMercadoPlayPlaylistUrl(url) {
  return /(?:^|[/.:])play\.mlstatic\.com\//i.test(String(url || ''));
}

/**
 * Decide entre JSON { challenge } e body bruto para o license server.
 * Mercado Play/Media Stream costuma usar body bruto (application/octet-stream)
 * — ajustar conforme achados da Fase 0.
 */
export function guessLicenseBodyFormat(licenseUrl) {
  const s = String(licenseUrl || '').toLowerCase();
  if (s.includes('widevine') || s.includes('license')) return 'raw';
  return 'json';
}

export class MercadoPlayDRMHandler {
  constructor(options = {}) {
    this.widevine = new WidevineHandler(options);
    this.licenseServer = options.licenseServer || '';
    this.licenseCandidates = options.licenseCandidates || DEFAULT_LICENSE_CANDIDATES;
    this.verbose = options.verbose || false;
    this.onLog = options.onLog || (() => {});
  }

  log(message) {
    if (this.verbose) this.onLog(message);
  }

  /**
   * Detecta DRM em texto de manifesto do Mercado Play.
   * @param {string} manifestText
   * @returns {Promise<{hasDRM: boolean, type: string, pssh: string|null, kid: string|null}>}
   */
  async detectDRM(manifestText) {
    const wv = detectWidevine(manifestText);
    if (wv?.hasDrm) {
      return {
        hasDRM: true,
        type: wv.method === 'clearkey' ? 'clearkey' : 'widevine',
        pssh: wv.pssh,
        kid: wv.kid,
      };
    }

    // PlayReady (DASH): schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"
    const pr = /schemeIdUri\s*=\s*["']urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95["']/i.test(String(manifestText || ''));
    if (pr) {
      return { hasDRM: true, type: 'playready', pssh: null, kid: null };
    }

    return { hasDRM: false, type: null, pssh: null, kid: null };
  }

  /**
   * Detecta DRM a partir de um URL (busca o manifesto e analisa).
   * @param {string} url — URL .m3u8 ou .mpd.
   * @param {object} headers — headers HTTP.
   */
  async detectDRMFromUrl(url, headers = {}) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar manifesto do Mercado Play.`);
    return this.detectDRM(await res.text());
  }

  /**
   * Resolve o license server (explicitamente configurado ou candidatos).
   * @param {string} [hint] — URL sugerida (ex.: extraída da playlist).
   * @returns {string} URL do license server.
   */
  resolveLicenseServer(hint = '') {
    if (this.licenseServer) return this.licenseServer;
    if (hint) return hint;
    if (this.licenseCandidates?.length) return this.licenseCandidates[0];
    throw new DrmLicenseError(
      'License server do Mercado Play não configurado. Descubra a URL na Fase 0 (reconhecimento) e configure via --license-url ou no handler.'
    );
  }

  /**
   * Pipeline completo do Mercado Play: detecta → licencia → descriptografa.
   * @param {object} opts
   * @param {string} opts.manifestText — texto do manifesto.
   * @param {string} opts.encryptedFile — MP4 CENC baixado.
   * @param {string} opts.outputFile — arquivo final.
   * @param {object} [opts.headers] — headers (Authorization, Referer, cookies).
   * @param {string} [opts.licenseUrl] — license server (override).
   * @param {Array<{kid: string, key: string}>} [opts.keys] — chaves já
   *   conhecidas (ex.: capturadas com extensão de navegador). Quando
   *   fornecidas, pula a aquisição de licença (não precisa de device).
   * @returns {Promise<{decrypted: boolean, output: string, keys: Array, drm: object}>}
   */
  async processEncryptedStream({ manifestText, encryptedFile, outputFile, headers = {}, licenseUrl = '', keys = [] }) {
    const drm = await this.detectDRM(manifestText);
    if (!drm.hasDRM) {
      this.log('[mercadoplay-drm] Sem DRM detectado — pulando descriptografia');
      return { decrypted: false, output: encryptedFile, keys: [], drm };
    }

    if (drm.type === 'playready') {
      throw new DrmLicenseError(
        'Conteúdo protegido com PlayReady. O StreamGrab suporta Widevine (L3); PlayReady exige pyplayready (fase de expansão).'
      );
    }

    this.log(`[mercadoplay-drm] DRM detectado: ${drm.type} (${drm.pssh ? 'com PSSH' : 'sem PSSH'})`);

    // Chaves manuais (ex.: WidevineProxy2/wvg no navegador) → pula pywidevine.
    if (keys?.length) {
      this.log(`[mercadoplay-drm] ${keys.length} chave(s) fornecida(s) manualmente — sem licença necessária`);
      await this.widevine.decrypt(encryptedFile, outputFile, keys);
      return { decrypted: true, output: outputFile, keys, drm };
    }

    const licenseServer = this.resolveLicenseServer(licenseUrl);
    const rawBody = guessLicenseBodyFormat(licenseServer) === 'raw';

    const licenseKeys = await this.widevine.acquireLicense({
      pssh: drm.pssh,
      licenseUrl: licenseServer,
      headers,
      rawBody,
    });
    await this.widevine.decrypt(encryptedFile, outputFile, licenseKeys);
    return { decrypted: true, output: outputFile, keys: licenseKeys, drm };
  }
}
