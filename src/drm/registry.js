/**
 * P1-DRM — Registry de handlers DRM (src/drm/registry.js)
 *
 * Centraliza os handlers por serviço/DRM (fase 4 do plano — expansão).
 * Para o Mercado Play, o handler é o MercadoPlayDRMHandler; o pipeline
 * Widevine genérico cobre outros serviços que usam Widevine L3.
 */

import { WidevineHandler } from './widevine.js';
import { MercadoPlayDRMHandler } from './mercado-play.js';
import { DRMDownloader } from './downloader.js';
import { startDownload } from '../ffmpeg.js';
import fs from 'node:fs';

export const drmHandlers = {
  mercadoplay: MercadoPlayDRMHandler,
  widevine: WidevineHandler,
};

/**
 * Retorna a classe do handler DRM para um serviço.
 * @param {string} service — id do serviço ('mercadoplay') ou tipo ('widevine').
 * @returns {Function} Classe do handler.
 */
export function getDRMHandlerClass(service) {
  const key = String(service || '').toLowerCase();
  return drmHandlers[key] || WidevineHandler;
}

/**
 * Instancia o handler DRM para um serviço.
 * @param {string} service
 * @param {object} options — opções passadas ao constructor.
 */
export function createDRMHandler(service, options = {}) {
  const Cls = getDRMHandlerClass(service);
  return new Cls(options);
}

/**
 * Retorna o handler DRM adequado a uma URL (Mercado Play → handler
 * específico; caso contrário → Widevine genérico).
 */
export function resolveDRMHandlerForUrl(url, options = {}) {
  if (/(?:^|[/.:])play\.mlstatic\.com\//i.test(String(url || ''))) {
    return new MercadoPlayDRMHandler(options);
  }
  return new WidevineHandler(options);
}

/**
 * Orquestrador DRM de alto nível: baixa (se ainda não baixado) e
 * descriptografa um stream protegido. Usado pelo fluxo CLI `drm download`.
 *
 * @param {object} opts
 * @param {string} opts.url — URL da playlist/segmento.
 * @param {string} opts.outputFile — caminho do arquivo final.
 * @param {string} [opts.manifestText] — texto do manifesto (se já baixado).
 * @param {object} [opts.headers] — headers HTTP.
 * @param {string} [opts.licenseUrl] — license server (override).
 * @param {Array<{kid: string, key: string}>} [opts.keys] — chaves já
 *   conhecidas (capturadas com extensão de navegador). Quando fornecidas,
 *   pula a aquisição de licença (não precisa de device/CDM).
 * @param {boolean} [opts.download] — baixa o stream criptografado via FFmpeg
 *   antes de descriptografar (padrão: true quando `url` existe).
 * @param {string} [opts.service] — 'mercadoplay' ou outro id.
 * @param {Function} [opts.onLog]
 */
export async function runDRMPipeline(opts = {}) {
  const {
    url,
    outputFile,
    manifestText: preManifest,
    headers = {},
    licenseUrl = '',
    keys = [],
    download = Boolean(url),
    service = 'mercadoplay',
    onLog = () => {},
  } = opts;

  const handler = createDRMHandler(service, { verbose: true, onLog });

  // 1. Manifesto (fornecido ou baixado agora)
  let manifestText = preManifest;
  if (!manifestText && url) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar manifesto.`);
    manifestText = await res.text();
  }
  if (!manifestText) throw new Error('Manifesto indisponível para pipeline DRM.');

  // 2. Detecção
  const drm = await handler.detectDRM(manifestText);
  if (!drm.hasDRM) {
    onLog('[drm] Sem proteção de conteúdo detectada — nada a descriptografar.');
    return { decrypted: false, output: outputFile, keys: [], drm };
  }

  // 3. Download do stream criptografado (se solicitado e ainda não baixado)
  let encryptedFile = outputFile;
  if (download && url && !fs.existsSync(outputFile)) {
    encryptedFile = await downloadEncryptedStream(url, headers, outputFile, onLog);
  }
  if (!fs.existsSync(encryptedFile)) {
    throw new Error(
      `Arquivo criptografado não encontrado em ${encryptedFile}. ` +
      'Baixe o stream primeiro (use a URL da playlist) e tente novamente.'
    );
  }

  // 4. Licença (ou chaves manuais) + descriptografia
  if (typeof handler.processEncryptedStream === 'function') {
    return handler.processEncryptedStream({
      manifestText,
      encryptedFile,
      outputFile,
      headers,
      licenseUrl,
      keys,
    });
  }

  // Widevine genérico
  return handler.processEncryptedStream?.({
    manifestText,
    encryptedFile,
    outputFile,
    licenseUrl,
    headers,
    keys,
  });
}

/**
 * Baixa o stream criptografado via FFmpeg (-c copy) para um arquivo
 * temporário `.encrypted.mp4`. O FFmpeg preserva as boxes CENC/PSSH.
 */
async function downloadEncryptedStream(url, headers, finalOutput, onLog = () => {}) {
  const encryptedFile = finalOutput.replace(/\.mp4$/i, '.encrypted.mp4');
  onLog(`[drm] Baixando stream criptografado (FFmpeg -c copy)...`);
  const { promise, stop } = startDownload({
    url,
    output: encryptedFile,
    headers,
    modeIndex: 0,
    outputArgs: ['-c', 'copy', '-movflags', 'faststart'],
  });
  const result = await promise;
  if (!result.ok) {
    try {
      if (fs.existsSync(encryptedFile)) fs.unlinkSync(encryptedFile);
    } catch {
      /* best-effort */
    }
    throw new Error(`Falha ao baixar stream criptografado: ${result.error || result.stderr || 'erro desconhecido'}`);
  }
  onLog(`[drm] Stream baixado: ${encryptedFile}`);
  return encryptedFile;
}

export { DRMDownloader };
