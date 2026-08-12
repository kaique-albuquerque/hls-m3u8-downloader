/**
 * P5 — Muxer (src/ffmpeg/muxer.js)
 *
 * Comandos FFmpeg de remux/mux, centralizados (seção 20 do architect.md):
 *  - remux com modos de compatibilidade (copy / copy-adtstoasc / aac);
 *  - mux de vídeo + áudio separados;
 *  - sempre stream copy quando possível (evita perda de qualidade e
 *    processamento desnecessário).
 *
 * `startDownload`/`startMuxDownload` preservam o contrato da API legada de
 * src/ffmpeg.js ({ promise, stop } síncronos, modo em startDownload);
 * `remux`/`mux` são os nomes canônicos novos. Nenhuma lógica de spawn
 * duplicada aqui — tudo delega para o FfmpegService.
 */

import { DEFAULT_USER_AGENT, normalizeHeaders } from '../utils.js';
import { FfmpegService, ffmpegService } from './service.js';

/** Modos de extração do FFmpeg (fallbacks de compatibilidade). */
export const MODES = [
  { name: 'copy', args: ['-c', 'copy'] },
  { name: 'copy-adtstoasc', args: ['-c', 'copy', '-bsf:a', 'aac_adtstoasc'] },
  { name: 'aac', args: ['-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart'] },
];

/** Rótulos dos modos, na mesma ordem de MODES. */
export const MODE_LABELS = [
  'copia direta (-c copy)',
  'copia direta com correcao de audio (aac_adtstoasc)',
  'reconversao do audio para AAC (-c:a aac)',
];

/**
 * Converte o objeto de headers em uma única string no formato exigido pelo
 * parâmetro -headers do FFmpeg (linhas separadas por CRLF).
 */
export function formatHeaders(headers) {
  const entries = Object.entries(headers || {}).filter(([, v]) => v && String(v).trim());
  if (!entries.length) return '';
  return entries.map(([k, v]) => `${k}: ${String(v).trim()}\r\n`).join('');
}

/**
 * Monta os args de um download/remux via FFmpeg. Puro (sem I/O) — testável.
 * `extraArgs` (ex.: ['-allowed_extensions', 'ALL']) entram antes do -i,
 * pois são opções de entrada do demuxer HLS. `outputArgs` (ex.: ['-vn']) são
 * opções de saída e entram depois do -i, antes dos args do modo.
 */
export function buildDownloadArgs({ url, output, headers = {}, modeIndex = 0, extraArgs = [], outputArgs = [] }) {
  const mode = MODES[modeIndex] || MODES[0];
  const isRemoteInput = /^https?:\/\//i.test(String(url || ''));
  const effectiveHeaders = normalizeHeaders(headers);
  if (isRemoteInput && !effectiveHeaders['User-Agent']) effectiveHeaders['User-Agent'] = DEFAULT_USER_AGENT;
  const headerStr = formatHeaders(effectiveHeaders);
  const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y'];
  if (isRemoteInput && headerStr) args.push('-headers', headerStr);
  args.push(...extraArgs, '-i', url, '-progress', 'pipe:1', ...outputArgs, ...mode.args, output);
  return args;
}

/** Monta os args de mux vídeo + áudio (sempre copy). Puro — testável. */
export function buildMuxArgs({ videoInput, audioInput, output }) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostats',
    '-y',
    '-i', videoInput,
    '-i', audioInput,
    '-progress', 'pipe:1',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    output,
  ];
}

/**
 * Baixa/remuxa via FFmpeg com fallback de modos (copy → adtstoasc → aac).
 * Contrato legado preservado: retorna { promise, stop, mode } síncrono.
 */
export function startDownload({ url, output, headers = {}, modeIndex = 0, onProgress, extraArgs = [], outputArgs = [], signal } = {}) {
  const mode = MODES[modeIndex] || MODES[0];
  const { promise, stop } = ffmpegService.run({
    args: buildDownloadArgs({ url, output, headers, modeIndex, extraArgs, outputArgs }),
    onProgress,
    signal,
  });
  return { promise, stop, mode };
}

/**
 * Junta vídeo + áudio separados em um único arquivo (-c copy). Contrato
 * legado preservado: retorna { promise, stop } síncrono.
 */
export function startMuxDownload({ videoInput, audioInput, output, onProgress, signal } = {}) {
  const { promise, stop } = ffmpegService.run({
    args: buildMuxArgs({ videoInput, audioInput, output }),
    onProgress,
    signal,
  });
  return { promise, stop };
}

/**
 * Nome canônico: remux/copy de uma única entrada (modo copy por padrão;
 * `modeIndex` permite os fallbacks de compatibilidade).
 */
export function remux(opts) {
  return startDownload(opts);
}

/** Nome canônico: mux de vídeo + áudio separados. */
export function mux(opts) {
  return startMuxDownload(opts);
}

// Re-export para quem precisa construir o serviço com injeção (testes).
export { FfmpegService };
