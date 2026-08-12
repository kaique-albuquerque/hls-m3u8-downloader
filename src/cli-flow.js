import fs from 'node:fs';
import path from 'node:path';

import { createStreamGrabCore } from './core/index.js';
import { checkFfmpeg } from './ffmpeg.js';
import { fetchPlaylist } from './hls.js';
import { needsMdstrmRefresh, extractMdstrmVideoId, refreshMdstrmUrl } from './mdstrm.js';
import { resolveSourceAdapter, resolveSourceAdapterAsync } from './source-adapters.js';
import {
  normalizeUrl,
  maskUrl,
  sanitizeFilename,
  ensureMp4,
  getDefaultDownloadsDir,
  formatKbps,
  normalizeHeaders,
  getClipboardText,
  detectSourceType,
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
import { loadConfig, parseCliHeaders, parseCliAuth, isGoogleVideoPlaybackUrl, collectDevtoolsHeaders } from './cli/config.js';
import { runDownloadFlow, runMuxedDownloadFlow } from './cli/download.js';
import { runTurboDownloadFlow, runTurboMuxedDownloadFlow, DEFAULT_TURBO_CHUNKS } from './cli/turbo.js';
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

  // P2.6 — fachada publica do novo Core (strangler): a analise de fontes
  // baseadas em adapter (YouTube/redes sociais) passa pelo StreamGrabCore,
  // mantendo o comportamento observavel da CLI identico. HLS/DASH/direto
  // continuam nos fluxos tolerantes a falha atuais; os fluxos de download
  // (turbo/mux/curl) seguem dedicados ate os transports serem migrados.
  const core = createStreamGrabCore();

  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage(safeIo);
    return { code: 0, ok: true };
  }

  printHeader(safeIo);

  let useCurlFlag = argv.includes('--curl-impersonate') || argv.includes('--ci');
  const forceYouTube = argv.includes('--youtube');
  const config = loadConfig(projectRoot, safeIo);
  let headers = normalizeHeaders({ ...config.headers, ...parseCliHeaders(argv) });

  // Rollback da P4 (transports): com STREAMGRAB_LEGACY_FLOW=1 a CLI volta aos
  // fluxos antigos — desativa turbo (transports/range) e curl-impersonate
  // (transports/curl) e usa somente os fluxos legados de cli/download.js.
  const legacyFlow = process.env.STREAMGRAB_LEGACY_FLOW === '1';
  if (legacyFlow) {
    useCurlFlag = false;
    safeIo.log('[legacy] STREAMGRAB_LEGACY_FLOW=1 — usando fluxos de download legados.');
  }

  // Autenticacao do yt-dlp: flag de CLI tem prioridade sobre config.json.
  const cliAuth = parseCliAuth(argv);
  const auth = {
    cookiesFile: cliAuth.cookiesFile || config.cookiesFile || '',
    cookiesFromBrowser: cliAuth.cookiesFromBrowser || config.cookiesFromBrowser || '',
  };
  if (auth.cookiesFile) safeIo.log(`[auth] Usando cookies do arquivo: ${auth.cookiesFile}`);
  if (auth.cookiesFromBrowser) safeIo.log(`[auth] Usando cookies do navegador: ${auth.cookiesFromBrowser}`);

  // Modo turbo (download paralelo por partes): flag de CLI tem prioridade sobre config.json.
  const turboEnabled = !legacyFlow && (argv.includes('--turbo') ? true : config.turbo === true);
  let turboChunks = DEFAULT_TURBO_CHUNKS;
  const chunksIdx = argv.indexOf('--chunks');
  if (chunksIdx !== -1 && Number(argv[chunksIdx + 1]) > 0) turboChunks = Number(argv[chunksIdx + 1]);
  else if (config.turboChunks > 0) turboChunks = config.turboChunks;
  if (turboEnabled) safeIo.log(`[turbo] Download paralelo ativado (${turboChunks} conexoes).`);

  // P6.2 — Smart Turbo (adaptativo por baseline): `--smart-turbo` liga por CLI
  // (defaults); `--no-smart-turbo` desliga (rollback explicito); config.json/
  // settings `smartTurbo` liga com defaults ou objeto de opcoes. Sem turbo, o
  // Smart Turbo nao faz sentido.
  const smartTurboFlag = argv.includes('--smart-turbo') ? true : argv.includes('--no-smart-turbo') ? false : config.smartTurbo;
  const smartTurboEnabled =
    turboEnabled &&
    smartTurboFlag !== false &&
    (smartTurboFlag === true || (smartTurboFlag && typeof smartTurboFlag === 'object'));
  if (smartTurboEnabled) {
    const opts = typeof smartTurboFlag === 'object' ? smartTurboFlag : {};
    const detail = opts.max ? ` (max ${opts.max}, janela ${opts.windowMs || 1200}ms)` : '';
    safeIo.log(`[turbo] Smart Turbo ativado${detail} — concurrency adaptativa (rampa/backoff).`);
  } else if (turboEnabled && smartTurboFlag !== false) {
    safeIo.log('[turbo] Smart Turbo desligado (pool fixo) — habilite via config.smartTurbo.');
  }

  // P6.1 — Resume de downloads por partes: ativo por default; `--no-resume` desliga
  // (rollback: restaura truncate + limpeza do parcial no cancelamento).
  const resumeEnabled = !argv.includes('--no-resume') && config.resume !== false;
  if (turboEnabled && !resumeEnabled) safeIo.log('[resume] Desativado (--no-resume): interrupcoes descartam o parcial.');

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
  let url = normalizeUrl(rawUrl);
  if (!url) {
    safeIo.error('\n[ERRO] Nenhuma URL informada.');
    return { code: 1, ok: false };
  }

  // mdstrm: URL crua do CDN (tokens presos à sessão do player) dá 403 para
  // qualquer cliente — converte para a URL do player usando o embed público.
  if (needsMdstrmRefresh(url)) {
    const videoId = extractMdstrmVideoId(url);
    if (videoId) {
      safeIo.log(`\n[mdstrm] URL da Media Stream detectada (videoId ${videoId}).`);
      safeIo.log('[mdstrm] Buscando credenciais do player no embed publico...');
      try {
        const refreshed = await refreshMdstrmUrl(url);
        safeIo.log(`[mdstrm] URL do player gerada: ${maskUrl(refreshed)}`);
        url = refreshed;
      } catch (err) {
        safeIo.log(`[mdstrm] Nao foi possivel converter: ${err.message}`);
        safeIo.log('[mdstrm] Continuando com a URL original.');
      }
    }
  }

  let adapter = forceYouTube && sourceLooksLikeYouTubeWatch(url)
    ? resolveSourceAdapter('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    : await resolveSourceAdapterAsync(url, headers);
  const sourceType = adapter.id;
  if (sourceType === 'unknown') {
    safeIo.error('\n[ERRO] A URL nao parece ser uma fonte suportada.');
    safeIo.error('Use uma URL HTTP/HTTPS contendo ".m3u8", ".mpd", um arquivo direto como ".mp4" / ".webm", ou uma URL sem extensao cujo servidor responda como video/audio (detectado automaticamente).');
    return { code: 1, ok: false };
  }
  safeIo.log(`URL reconhecida: ${maskUrl(url)}`);
  safeIo.log(`Tipo detectado: ${describeSourceType(sourceType)}`);
  if (sourceType === 'direct' && detectSourceType(url) === 'unknown' && adapter.detectedContentType) {
    safeIo.log(`[probe] URL sem extensao, mas o servidor respondeu "${adapter.detectedContentType}" — tratando como midia direta.`);
  }

  if (sourceType === 'direct' && isGoogleVideoPlaybackUrl(url)) {
    headers = await collectDevtoolsHeaders(answerFn, safeIo, headers);
  }

  let targetUrl = url;
  let info = null;
  if (ADAPTER_BASED_SOURCES.has(sourceType)) {
    safeIo.onState?.({ state: 'analyzing' });
    safeIo.log(`\nAnalisando ${describeSourceType(sourceType)}...`);
    try {
      // P2.6 — analise via StreamGrabCore (mesmo adapter e erro cru do yt-dlp;
      // info normalizado preserva titulo, variants e formatos usados abaixo).
      const analysis = await core.analyze(url, {
        headers,
        auth,
        forceYouTube: forceYouTube && sourceLooksLikeYouTubeWatch(url),
      });
      adapter = analysis.adapter;
      info = analysis.info;
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
      if (err.needsAuth) {
        safeIo.error('\nDica: o conteudo parece exigir login.');
        safeIo.error('  1. Instale a extensao "Get cookies.txt LOCALLY" no Chrome/Edge/Firefox e exporte os cookies do site.');
        safeIo.error('  2. Rode:  node src/index.js --cookies cookies.txt');
        safeIo.error('  3. Ou extraia direto do navegador:  node src/index.js --cookies-from-browser chrome');
      }
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
        if (!legacyFlow) {
          useCurlFlag = true;
          safeIo.log('\nAtivando o modo curl-impersonate...');
        } else {
          safeIo.log('[legacy] Modo curl-impersonate desativado pelo rollback STREAMGRAB_LEGACY_FLOW.');
        }
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
      auth,
    });
    targetUrl = preparedPlan?.downloadUrl || targetUrl;
  } catch (err) {
    safeIo.error(`\n[ERRO] ${err.message}`);
    return { code: 1, ok: false, error: err.code || 'prepare-download' };
  }

  let result;
  // Turbo so faz sentido em URLs diretas (YouTube/redes sociais/direct), nunca em HLS/DASH/curl.
  const turboEligible = !useCurlFlag && (ADAPTER_BASED_SOURCES.has(sourceType) || sourceType === 'direct');

  if (preparedPlan?.strategy === 'mux') {
    const muxOpts = {
      videoUrl: preparedPlan.videoUrl,
      audioUrl: preparedPlan.audioUrl,
      output,
      headers,
      videoBytes: preparedPlan.videoBytes,
      audioBytes: preparedPlan.audioBytes,
      totalBytes: preparedPlan.totalBytes,
      durationMs: preparedPlan.durationMs,
    };
    if (turboEnabled) {
      // Muxed usa tmpDir efemero (removido no finally) — resume de streams nao se aplica.
      result = await runTurboMuxedDownloadFlow(ctx, muxOpts);
      if (!result.ok && result.error === 'no-range') {
        safeIo.log('\n[AVISO] Turbo indisponivel; voltando ao fluxo padrao...');
        result = await runMuxedDownloadFlow(ctx, muxOpts);
      }
    } else {
      result = await runMuxedDownloadFlow(ctx, muxOpts);
    }
  } else if (turboEnabled && turboEligible) {
    result = await runTurboDownloadFlow(ctx, {
      url: targetUrl,
      output,
      headers,
      totalBytes: preparedPlan?.totalBytes,
      durationMs: preparedPlan?.durationMs,
      chunkCount: turboChunks,
      resume: resumeEnabled,
      smartTurbo: smartTurboEnabled ? smartTurboFlag : false,
    });
    if (!result.ok && result.error === 'no-range') {
      safeIo.log('[AVISO] Turbo indisponivel; voltando ao fluxo padrao...');
      result = await runDownloadFlow(ctx, {
        url: targetUrl,
        output,
        headers,
        totalBytes: preparedPlan?.totalBytes,
        durationMs: preparedPlan?.durationMs,
      });
    }
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
