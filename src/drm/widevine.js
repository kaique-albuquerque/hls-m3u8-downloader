/**
 * P1-DRM — Handler Widevine (src/drm/widevine.js)
 *
 * Implementa o pipeline Widevine L3:
 *   1. detectDRM(manifest) — identifica Widevine em HLS/DASH (PSSH, KID);
 *   2. extractPSSH(manifest) — extrai o PSSH (base64) do ContentProtection;
 *   3. acquireLicense(pssh, licenseUrl, headers) — chama pywidevine-wrapper
 *      e retorna as chaves KID:KEY;
 *   4. decrypt(input, output, keys) — chama mp4decrypt (Bento4).
 *
 * Integra com o DRMDownloader existente (src/drm/downloader.js) e com o
 * plano de bypass (plan/drm-mercado-play.md, fase 2).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getMp4decryptCommand } from '../core/binaries.js';
import { DrmInfraError, DrmLicenseError, DrmDecryptError } from '../core/errors.js';
import { acquireKeysWithPywidevine, hasWidevineDevice, getDefaultWidevineDevicePath } from './pywidevine-wrapper.js';

/** UUIDs Widevine no schemeIdUri de <ContentProtection> (DASH). */
export const WIDEVINE_UUID = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';
export const WIDEVINE_UUID_URN = `urn:uuid:${WIDEVINE_UUID}`;
/** KEYFORMAT Widevine em #EXT-X-KEY (HLS). */
export const WIDEVINE_KEYFORMAT = 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';
/** ClearKey (não-DRM, chave embutida) — tratado como caso à parte. */
export const CLEARKEY_UUID = '1077efec-c0b2-4d02-ace3-3c1e52e2fb4b';

/** Extrai PSSH (base64) e KID (hex) de um ContentProtection DASH. */
export function extractPsshFromContentProtection(tag) {
  const cenc = /<cenc:pssh\b[^>]*>([\s\S]*?)<\/cenc:pssh>/i.exec(tag)?.[1]?.trim();
  if (cenc) return cenc;
  const genericPssh = /<pssh\b[^>]*>([\s\S]*?)<\/pssh>/i.exec(tag)?.[1]?.trim();
  if (genericPssh) return genericPssh;
  return null;
}

/** Extrai o KID de um ContentProtection DASH (default_KID) ou #EXT-X-KEY. */
export function extractKidFromTag(tag) {
  const defaultKid = /default_KID\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
  if (defaultKid) return defaultKid.replace(/-/g, '');
  // cenc:default_KID dentro de ContentProtection
  const cencKid = /cenc:default_KID\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
  if (cencKid) return cencKid.replace(/-/g, '');
  return null;
}

/** Normaliza um KID (remove traços, minúsculas) para formato aceito pelo mp4decrypt. */
export function normalizeKid(kid) {
  return String(kid || '').replace(/-/g, '').toLowerCase();
}

/**
 * Analisa texto HLS/DASH e retorna informações de DRM Widevine.
 * Retorna null quando não há Widevine.
 */
export function detectWidevine(manifestText) {
  const s = String(manifestText || '');
  const result = { hasDrm: false, pssh: null, kid: null, method: null };

  // --- DASH: <ContentProtection schemeIdUri="urn:uuid:edef8ba9..."> ---
  const cpTags = s.match(/<ContentProtection\b[^>]*>/gi) || [];
  for (const tag of cpTags) {
    const scheme = /schemeIdUri\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '';
    const isWidevine = scheme.toLowerCase().includes(WIDEVINE_UUID);
    const isClearKey = scheme.toLowerCase().includes(CLEARKEY_UUID);
    if (isWidevine || isClearKey) {
      result.hasDrm = true;
      result.method = isWidevine ? 'widevine' : 'clearkey';
      result.pssh = extractPsshFromContentProtection(s) || null;
      result.kid = extractKidFromTag(tag) || null;
      break;
    }
  }

  // --- HLS: #EXT-X-KEY com KEYFORMAT="urn:uuid:edef8ba9..." ---
  if (!result.hasDrm) {
    const keyTags = s.match(/#EXT-X-KEY:[^\r\n]+/gi) || [];
    for (const line of keyTags) {
      const keyformat = /KEYFORMAT\s*=\s*"([^"]+)"/i.exec(line)?.[1] || '';
      if (keyformat.toLowerCase().includes(WIDEVINE_UUID) || keyformat.toLowerCase().includes(CLEARKEY_UUID)) {
        result.hasDrm = true;
        result.method = keyformat.toLowerCase().includes(WIDEVINE_UUID) ? 'widevine' : 'clearkey';
        result.kid = extractKidFromTag(line) || null;
        break;
      }
    }
  }

  return result.hasDrm ? result : null;
}

export class WidevineHandler {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.devicePath = options.devicePath || getDefaultWidevineDevicePath();
    this.python = options.python || 'python';
    this.onLog = options.onLog || (() => {});
  }

  log(message) {
    if (this.verbose) this.onLog(message);
  }

  /**
   * Verifica se a infraestrutura Widevine está disponível (mp4decrypt + device).
   * Lança DrmInfraError com instruções claras quando faltar algo.
   */
  checkInfra({ needDevice = true } = {}) {
    const missing = [];
    if (!fs.existsSync(getMp4decryptCommand())) missing.push('mp4decrypt (npm run mp4decrypt:install)');
    if (needDevice && !hasWidevineDevice(this.devicePath)) {
      missing.push(`device Widevine .wvd em ${this.devicePath} (npm run cdm:extract + pywidevine create-device)`);
    }
    if (missing.length) {
      throw new DrmInfraError(`Infraestrutura Widevine incompleta: ${missing.join(', ')}.`);
    }
  }

  /**
   * Detecta Widevine em um texto de manifesto (HLS ou DASH).
   * @param {string} manifestText
   * @returns {object|null} { hasDrm, pssh, kid, method } ou null.
   */
  detectDRM(manifestText) {
    return detectWidevine(manifestText);
  }

  /**
   * Detecta Widevine a partir de um URL (busca o manifesto).
   * @param {string} url — URL .m3u8 ou .mpd.
   * @param {object} headers — headers HTTP.
   * @returns {Promise<object|null>}
   */
  async detectDRMFromUrl(url, headers = {}) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar manifesto para detecção de DRM.`);
    return this.detectDRM(await res.text());
  }

  /**
   * Adquire as chaves Widevine via pywidevine.
   * @param {object} opts
   * @param {string} opts.pssh — PSSH base64.
   * @param {string} opts.licenseUrl — URL do license server.
   * @param {object} [opts.headers] — headers da requisição de licença.
   * @param {boolean} [opts.rawBody] — challenge como body bruto.
   * @returns {Promise<Array<{kid: string, key: string, type: string}>>}
   */
  async acquireLicense({ pssh, licenseUrl, headers = {}, rawBody = false }) {
    if (!pssh) throw new DrmLicenseError('PSSH não disponível para aquisição de licença Widevine.');
    if (!licenseUrl) throw new DrmLicenseError('License server URL não informada para Widevine.');
    this.log(`[widevine] Adquirindo licença de ${licenseUrl}`);
    try {
      const keys = await acquireKeysWithPywidevine({
        pssh,
        licenseUrl,
        headers,
        devicePath: this.devicePath,
        python: this.python,
        rawBody,
      });
      if (!keys.length) throw new DrmLicenseError('pywidevine não retornou nenhuma chave de conteúdo.');
      this.log(`[widevine] ${keys.length} chave(s) obtida(s)`);
      return keys;
    } catch (err) {
      if (err instanceof DrmLicenseError) throw err;
      throw new DrmLicenseError(err.message, { cause: err });
    }
  }

  /**
   * Descriptografa um arquivo MP4 CENC com mp4decrypt.
   * @param {string} inputFile
   * @param {string} outputFile
   * @param {Array<{kid: string, key: string}>} keys
   * @returns {Promise<{ok: boolean, output: string}>}
   */
  async decrypt(inputFile, outputFile, keys) {
    if (!fs.existsSync(inputFile)) {
      throw new DrmDecryptError(`Arquivo criptografado não encontrado: ${inputFile}`);
    }
    if (!keys?.length) throw new DrmDecryptError('Nenhuma chave fornecida para descriptografia.');
    this.checkInfra({ needDevice: false });

    const mp4decrypt = getMp4decryptCommand();
    const args = [];
    for (const k of keys) {
      args.push('--key', `${normalizeKid(k.kid)}:${k.key}`);
    }
    args.push(inputFile, outputFile);

    this.log(`[widevine] Descriptografando com mp4decrypt (${keys.length} chave(s))`);
    await new Promise((resolve, reject) => {
      const proc = spawn(mp4decrypt, args, { windowsHide: true });
      let stderr = '';
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        this.log(`[mp4decrypt] ${d.toString().trim()}`);
      });
      proc.on('error', (err) => reject(new DrmDecryptError(`Falha ao executar mp4decrypt: ${err.message}`)));
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new DrmDecryptError(`mp4decrypt falhou (código ${code}): ${stderr.trim()}`));
      });
    });

    if (!fs.existsSync(outputFile)) {
      throw new DrmDecryptError(`mp4decrypt terminou sem gerar ${outputFile}`);
    }
    return { ok: true, output: outputFile };
  }

  /**
   * Pipeline completo: detecta → licencia → descriptografa.
   * @param {object} opts
   * @param {string} opts.manifestText — texto do manifesto (HLS/DASH).
   * @param {string} opts.encryptedFile — arquivo MP4 CENC baixado.
   * @param {string} opts.outputFile — arquivo final descriptografado.
   * @param {string} [opts.licenseUrl] — URL do license server.
   * @param {object} [opts.headers] — headers da licença.
   * @param {Array<{kid: string, key: string}>} [opts.keys] — chaves já
   *   conhecidas (ex.: capturadas com extensão de navegador). Quando
   *   fornecidas, pula a aquisição de licença.
   * @returns {Promise<{decrypted: boolean, output: string, keys: Array, drm: object|null}>}
   */
  async processEncryptedStream({ manifestText, encryptedFile, outputFile, licenseUrl, headers = {}, rawBody = false, keys = [] }) {
    const drm = this.detectDRM(manifestText);
    if (!drm?.hasDrm) {
      return { decrypted: false, output: encryptedFile, keys: [], drm: null };
    }
    let contentKeys = keys;
    if (!contentKeys?.length) {
      contentKeys = await this.acquireLicense({ pssh: drm.pssh, licenseUrl, headers, rawBody });
    } else {
      this.log(`[widevine] ${contentKeys.length} chave(s) fornecida(s) manualmente — pulando licença`);
    }
    await this.decrypt(encryptedFile, outputFile, contentKeys);
    return { decrypted: true, output: outputFile, keys: contentKeys, drm };
  }
}
