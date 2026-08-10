import fs from 'node:fs';
import path from 'node:path';

import { checkFfmpeg } from './ffmpeg.js';
import { fetchPlaylist } from './hls.js';
import { resolveSourceAdapter } from './source-adapters.js';
import {
  normalizeUrl,
  maskUrl,
  sanitizeFilename,
  ensureMp4,
  getDefaultDownloadsDir,
  formatKbps,
  normalizeHeaders,
  getClipboardText,
} from './utils.js';
import { MODE_LABELS, createAnswerSource, createContext, onInterrupt, sourceLooksLikeYouTubeWatch } from './cli/context.js';
import {
  printHeader,
  printUsage,
  printFfmpegHelp,
  print403,
  chooseVariant,
  describeSourceType,
  resolveExistingFile,
} from './cli/ui.js';
import { loadConfig, parseCliHeaders, isGoogleVideoPlaybackUrl, collectDevtoolsHeaders } from './cli/config.js';
import { runDownloadFlow, runMuxedDownloadFlow } from './cli/download.js';
import { runCurlDownloadFlow } from './cli/curl-flow.js';

/** Tipos de fonte que usam o fluxo padrao "analyze -> chooseVariant -> prepareDownload". */
const ADAPTER_BASED_SOURCES = new Set(['youtube', 'social']);

export async function runCliSession({
  argv = [],
  projectRoot,
  ask,
  io,
  answers = {},
  registerCancel,
} = {}) {
  const safeIo = {
    log: (...parts) => console.log(...parts),
    error: (...parts) => console.error(...parts),
    onProgress: null,
    onProgressEnd: null,
    onStatus: null,
    onState: null,
    ...io,
  };
  const answerFn = ask || createAnswerSource(answers);
  const ctx = createContext(safeIo);
  registerCancel?.(() => onInterrupt(ctx));

  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage(safeIo);
    return { code: 0, ok: true };
  }

  printHeader(safeIo);

  let useCurlFlag = argv.includes('--curl-impersonate') || argv.includes('--ci');
  const forceYouTube = argv.includes('--youtube');
  const config = loadConfig(projectRoot, safeIo);
  let headers = normalizeHeaders({ ...config.headers, ...parseCliHeaders(argv) });

  safeIo.onState?.({ state: 'ffmpeg-check' });
  safeIo.log('\nVerificando FFmpeg...');
  if (!(await checkFfmpeg())) {
    safeIo.error('\n[ERRO] FFmpeg nao foi encontrado localmente nem no PATH do sistema.');
    printFfmpegHelp(safeIo);
    return { code: 1, ok: false };
  }
  safeIo.log('FFmpeg OK.');

  let rawUrl = (await answerFn('\nURL do video/playlist: ')).trim();
  if (!rawUrl) {
    const clip = getClipboardText();
    if (clip) {
      safeIo.log(`[clipboard] URL copiada detectada: ${maskUrl(clip)}`);
      rawUrl = clip;
    }
  }
  const url = normalizeUrl(rawUrl);
  if (!url) {
    safeIo.error('\n[ERRO] Nenhuma URL informada.');
    return { code: 1, ok: false };
  }
  const adapter = forceYouTube && sourceLooksLikeYouTubeWatch(url)
    ? resolveSourceAdapter('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    : resolveSourceAdapter(url);
  const sourceType = adapter.id;
  if (sourceType === 'unknown') {
    safeIo.error('\n[ERRO] A URL nao parece ser uma fonte suportada.');
    safeIo.error('Use uma URL HTTP/HTTPS contendo ".m3u8", ".mpd", um arquivo direto como ".mp4" / ".webm", ou implemente um adaptador especifico.');
    return { code: 1, ok: false };
  }
  safeIo.log(`URL reconhecida: ${maskUrl(url)}`);
  safeIo.log(`Tipo detectado: ${describeSourceType(sourceType)}`);

  if (sourceType === 'direct' && isGoogleVideoPlaybackUrl(url)) {
    headers = await collectDevtoolsHeaders(answerFn, safeIo, headers);
  }

  let targetUrl = url;
  let info = null;
  if (ADAPTER_BASED_SOURCES.has(sourceType)) {
    safeIo.onState?.({ state: 'analyzing' });
    safeIo.log(`\nAnalisando ${describeSourceType(sourceType)}...`);
    try {
      info = await adapter.analyze({ url, headers });
      safeIo.log(`Video detectado: ${info.title}`);
      if (info.progressiveFormats?.length) {
        safeIo.log(`Formatos progressivos disponiveis: ${info.progressiveFormats.length}`);
      }
      if (info.adaptiveVideoFormats?.length && info.adaptiveAudioFormats?.length) {
        safeIo.log(`Formatos adaptativos disponiveis: ${info.adaptiveVideoFormats.length} videos + ${info.adaptiveAudioFormats.length} audios`);
      }
      const chosen = await chooseVariant(answerFn, safeIo, info.variants, '');
      if (!chosen) {
        safeIo.log('\nCancelado.');
        return { code: 0, ok: false, cancelled: true };
      }
      targetUrl = chosen;
      safeIo.log(`Formato escolhido: ${chosen}`);
    } catch (err) {
      safeIo.error(`\n[ERRO] ${err.message}`);
      return { code: 1, ok: false, error: err.code || sourceType };
    }
  } else if (sourceType === 'hls' && !useCurlFlag) {
    safeIo.onState?.({ state: 'analyzing' });
    safeIo.log('\nAnalisando playlist...');
    try {
      info = await fetchPlaylist(url, headers);
    } catch (err) {
      if (err.status === 403) {
        print403(safeIo);
        const ans = (await answerFn('\nO servidor parece bloquear clientes que nao sejam navegadores.\nTentar contornar com curl-impersonate (imita o TLS de um navegador real)? (S/n): '))
          .trim()
          .toUpperCase();
        if (ans.startsWith('N')) return { code: 1, ok: false };
        useCurlFlag = true;
        safeIo.log('\nAtivando o modo curl-impersonate...');
      } else {
        safeIo.log(`[AVISO] Nao foi possivel analisar a playlist (${err.message}).`);
        safeIo.log('O download tentara usar a URL fornecida diretamente.');
      }
    }

    if (!useCurlFlag && info?.kind === 'master' && info.variants.length > 0) {
      const chosen = await chooseVariant(answerFn, safeIo, info.variants, info.baseUrl || url);
      if (!chosen) {
        safeIo.log('\nCancelado.');
        return { code: 0, ok: false, cancelled: true };
      }
      targetUrl = chosen;
      safeIo.log(`Variant escolhida: ${maskUrl(targetUrl)}`);
    } else if (!useCurlFlag && info?.kind === 'unknown') {
      safeIo.log('[AVISO] A playlist nao parece ser HLS padrao. Continuando mesmo assim.');
    }
  } else if (sourceType === 'dash') {
    safeIo.onState?.({ state: 'analyzing' });
    safeIo.log('\nAnalisando manifesto DASH...');
    try {
      const dashInfo = await adapter.analyze({ url, headers });
      const topVideo = dashInfo.videoRepresentations[0];
      if (topVideo) {
        safeIo.log(`Representacoes de video encontradas: ${dashInfo.videoRepresentations.length}`);
        safeIo.log(`Melhor representacao detectada: ${topVideo.resolution || 'sem resolucao'}${topVideo.bandwidth ? `  ~${formatKbps(topVideo.bandwidth)}` : ''}`);
      } else {
        safeIo.log('Manifesto DASH carregado. O FFmpeg tentara resolver as representacoes automaticamente.');
      }
    } catch (err) {
      safeIo.log(`[AVISO] Nao foi possivel analisar o manifesto DASH (${err.message}).`);
      safeIo.log('O download tentara usar a URL fornecida diretamente.');
    }
  } else if (sourceType === 'direct') {
    safeIo.log('\nArquivo direto detectado. O download seguira sem analise de playlist.');
  }

  const rawName = await answerFn('\nNome do arquivo (sem extensao): ');
  const fileName = ensureMp4(sanitizeFilename(rawName));

  const defaultDir = getDefaultDownloadsDir();
  const rawDir = await answerFn(`Pasta de saida (Enter = ${defaultDir}): `);
  const dir = rawDir.trim() ? path.resolve(rawDir.trim()) : defaultDir;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    safeIo.error(`\n[ERRO] Nao foi possivel usar a pasta "${dir}": ${err.message}`);
    return { code: 1, ok: false };
  }

  let output = path.join(dir, fileName);
  const resolved = await resolveExistingFile(answerFn, safeIo, output);
  if (resolved.action === 'cancel') {
    safeIo.log('\nCancelado.');
    return { code: 0, ok: false, cancelled: true };
  }
  output = resolved.output;

  safeIo.log(`\nSalvando em: ${output}`);
  safeIo.onState?.({ state: 'ready', output, targetUrl });

  let preparedPlan;
  try {
    preparedPlan = await adapter.prepareDownload({
      url,
      headers,
      output,
      analysis: info,
      selectedUrl: targetUrl,
    });
    targetUrl = preparedPlan?.downloadUrl || targetUrl;
  } catch (err) {
    safeIo.error(`\n[ERRO] ${err.message}`);
    return { code: 1, ok: false, error: err.code || 'prepare-download' };
  }

  let result;
  if (preparedPlan?.strategy === 'mux') {
    result = await runMuxedDownloadFlow(ctx, {
      videoUrl: preparedPlan.videoUrl,
      audioUrl: preparedPlan.audioUrl,
      output,
      headers,
      videoBytes: preparedPlan.videoBytes,
      audioBytes: preparedPlan.audioBytes,
      totalBytes: preparedPlan.totalBytes,
      durationMs: preparedPlan.durationMs,
    });
  } else {
    result = useCurlFlag && sourceType === 'hls'
      ? await runCurlDownloadFlow(ctx, { ask: answerFn, url: targetUrl, output, headers })
      : await runDownloadFlow(ctx, {
          url: targetUrl,
          output,
          headers,
          totalBytes: preparedPlan?.totalBytes,
          durationMs: preparedPlan?.durationMs,
        });
  }

  if (result?.error === 'cancelado') {
    safeIo.log('\nCancelado.');
    return { code: 0, ok: false, cancelled: true };
  }
  if (result?.error === 'curl-ausente') return { code: 1, ok: false };

  if (result.ok) {
    safeIo.log('\nDownload concluido!');
    safeIo.log(`Arquivo salvo em: ${output}`);
    return { code: 0, ok: true, output, targetUrl, mode: MODE_LABELS[result.modeIndex] };
  }

  if (result.interrupted) return { code: 130, ok: false, interrupted: true };

  safeIo.log('\nO download nao pode ser concluido. Revise a URL e tente novamente.');
  return { code: 1, ok: false, error: result.error || 'falha' };
}

export function createInterruptHandler(io) {
  const ctx = createContext(io);
  return () => onInterrupt(ctx);
}
