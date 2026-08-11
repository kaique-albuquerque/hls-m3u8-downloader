/**
 * P4 — Runner de download via yt-dlp (plano §15/§16).
 *
 * Executa o download com o proprio yt-dlp (binario standalone) APENAS quando
 * ele e a opcao correta para a fonte (provider ytdlp com formato solicitado)
 * — nunca como fallback generico de transporte (plano §6: yt-dlp so assume
 * o download quando e a opcao correta para a fonte).
 *
 * Em todos os outros casos o projeto prefere as URLs diretas decifradas pelo
 * yt-dlp e os transports HTTP/Range/FFmpeg existentes.
 */

import { youtubeDl } from 'youtube-dl-exec';
import { YtDlpError, CancelledError } from '../core/errors.js';

function toYtDlpError(err) {
  const yerr = new YtDlpError(`Falha no download via yt-dlp: ${err?.message || String(err)}`, {
    detail: String(err?.stderr || ''),
  });
  if (err?.status) yerr.status = Number(err.status);
  return yerr;
}

/**
 * Executa o download de `url` no formato `formatId` para `output` via yt-dlp.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {string} [params.formatId] — format selector do yt-dlp (default 'best').
 * @param {string} params.output — caminho final do arquivo.
 * @param {object} [params.headers] — user-agent opcional.
 * @param {object} [params.auth] — cookiesFile/cookiesFromBrowser opcionais.
 * @param {AbortSignal} [params.signal] — cancela (mata o processo, se exposto).
 * @param {Function} [params.onProgress] — `({bytesDownloaded, totalBytes, percent, message})`.
 * @returns {Promise<{ok: true, [key: string]: any}>}
 * @throws YtDlpError em falha; CancelledError em abort.
 */
export async function runYtDlpDownload({ url, formatId, output, headers = {}, auth = {}, signal, onProgress } = {}) {
  if (!url) throw new TypeError('runYtDlpDownload: url e obrigatoria');
  if (!output) throw new TypeError('runYtDlpDownload: output e obrigatorio');

  const options = {
    format: formatId || 'best',
    output,
    noPlaylist: true,
    noWarnings: true,
    noCheckCertificates: true,
  };
  const userAgent = headers?.['user-agent'] || headers?.['User-Agent'];
  if (userAgent) options.userAgent = userAgent;
  if (auth?.cookiesFile) options.cookies = auth.cookiesFile;
  if (auth?.cookiesFromBrowser) options.cookiesFromBrowser = auth.cookiesFromBrowser;

  let promise;
  try {
    promise = youtubeDl(url, options);
  } catch (err) {
    throw toYtDlpError(err);
  }

  let rejectAbort = null;
  const abortPromise = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    try {
      promise?.child?.kill?.('SIGKILL');
    } catch {
      /* ignora */
    }
    rejectAbort?.(new CancelledError('Operacao cancelada.'));
  };
  if (signal) {
    if (signal.aborted) {
      try {
        promise?.child?.kill?.('SIGKILL');
      } catch {
        /* ignora */
      }
      throw new CancelledError('Operacao cancelada.');
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const result = await Promise.race([promise, abortPromise]);
    if (signal?.aborted) throw new CancelledError('Operacao cancelada.');
    onProgress?.({ bytesDownloaded: 0, totalBytes: 0, percent: 100, message: 'Download concluido via yt-dlp.' });
    return { ok: true, ...(result && typeof result === 'object' ? result : {}) };
  } catch (err) {
    if (signal?.aborted || err?.code === 'CANCELLED') throw new CancelledError('Operacao cancelada.');
    throw toYtDlpError(err);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    rejectAbort = null;
  }
}

export default { runYtDlpDownload };
