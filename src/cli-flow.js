import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkFfmpeg, startDownload } from './ffmpeg.js';
import { fetchPlaylist, parsePlaylistText, parseSegmentPlaylist } from './hls.js';
import { createCurlClient, findCurlImpersonate, killAllCurl } from './curlimp.js';
import { resolveSourceAdapter } from './source-adapters.js';
import {
  extractMdstrmVideoId,
  fetchMdstrmPlayerVars,
  buildPlayerUrl,
  isMdstrmUrl,
  needsMdstrmRefresh,
} from './mdstrm.js';
import {
  normalizeUrl,
  maskUrl,
  sanitizeFilename,
  ensureMp4,
  getDefaultDownloadsDir,
  formatBytes,
  formatKbps,
  normalizeHeaders,
  getClipboardText,
} from './utils.js';

const MODE_LABELS = [
  'copia direta (-c copy)',
  'copia direta com correcao de audio (aac_adtstoasc)',
  'reconversao do audio para AAC (-c:a aac)',
];

function createContext(io) {
  return {
    currentFfmpeg: null,
    interruptHandled: false,
    curlimpActive: false,
    io,
  };
}

function onInterrupt(ctx) {
  if (ctx.interruptHandled) return;
  ctx.interruptHandled = true;

  if (ctx.currentFfmpeg) {
    ctx.io.log('\n\nInterrompendo o download... (aguarde)');
    ctx.currentFfmpeg.stop();
    return;
  }
  if (ctx.curlimpActive) {
    ctx.io.log('\n\nCancelando o download dos segmentos... (aguarde)');
    killAllCurl();
    return;
  }
  ctx.io.log('\nOperacao cancelada.');
}

function printHeader(io) {
  io.log('==============================================');
  io.log('   Video Downloader - HLS / DASH / Midia direta');
  io.log('   via FFmpeg + curl-impersonate (opcional)');
  io.log('==============================================');
}

function printUsage(io) {
  io.log('');
  io.log('Video Downloader - HLS / DASH / Midia direta via FFmpeg');
  io.log('');
  io.log('Uso:');
  io.log('  npm start');
  io.log('  node src/index.js');
  io.log('  npm run download:curl');
  io.log('  npm run download:youtube');
  io.log('');
  io.log('Opcoes:');
  io.log('  --curl-impersonate   Forca o modo curl-impersonate para HLS');
  io.log('  --youtube            Entra no fluxo do adaptador de YouTube');
  io.log('');
}

function printFfmpegHelp(io) {
  io.log('');
  io.log('Como instalar o FFmpeg no Windows:');
  io.log('  1. Baixe uma build estavel em https://www.gyan.dev/ffmpeg/builds/');
  io.log('  2. Extraia o ZIP em uma pasta, por exemplo C:\\ffmpeg.');
  io.log('  3. Adicione a pasta bin ao PATH.');
  io.log('  4. Abra um novo terminal e teste com: ffmpeg -version');
}

function print403(io) {
  io.error('\n[ERRO 403] A URL foi recusada pelo servidor.');
  io.error('Ela pode ter expirado ou o servidor pode exigir os mesmos headers HTTP utilizados pelo navegador.');
  io.error('Obtenha uma Request URL nova no DevTools e tente novamente.');
  io.error('Se o servidor exigir headers especificos (Referer, Origin, User-Agent),');
  io.error('configure-os em config.json ou use --referer / --origin / --user-agent.');
  io.error('Obs.: alguns CDNs bloqueiam qualquer cliente que nao seja um navegador real.');
  io.error('Nesse caso, o modo curl-impersonate (--curl-impersonate) pode contornar o bloqueio.');
}

function printCurlImpHelp(io) {
  io.log('');
  io.log('Como instalar o curl-impersonate no Windows:');
  io.log('  1. Acesse https://github.com/lexiforest/curl-impersonate/releases');
  io.log('  2. Extraia o ZIP em qualquer pasta.');
  io.log('  3. Coloque o binario em tools/ ou no PATH.');
  io.log('  4. Rode novamente com: npm run download:curl');
}

function loadConfig(projectRoot, io) {
  const configPath = path.join(projectRoot, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { headers: raw.headers || {} };
    }
  } catch (err) {
    io.log(`[AVISO] config.json invalido: ${err.message}`);
  }
  return { headers: {} };
}

function parseCliHeaders(argv) {
  const headers = {};
  const map = {
    '--referer': 'Referer',
    '--origin': 'Origin',
    '--user-agent': 'User-Agent',
    '--useragent': 'User-Agent',
  };
  for (let i = 0; i < argv.length; i++) {
    const key = map[argv[i]];
    if (key && argv[i + 1] !== undefined) headers[key] = argv[i + 1];
  }
  return headers;
}

function cleanupPartial(output) {
  try {
    if (fs.existsSync(output)) fs.unlinkSync(output);
  } catch {
    /* ignora */
  }
}

function analyzeFailure(result) {
  const stderr = String(result?.stderr || '').toLowerCase();
  if (stderr.includes('403') || stderr.includes('forbidden')) return '403';
  if (
    stderr.includes('could not find tag') ||
    stderr.includes('not currently supported in container') ||
    stderr.includes('audio codec') ||
    stderr.includes('invalid data') ||
    stderr.includes('moov atom not found')
  ) {
    return 'incompatibilidade de audio/container';
  }
  return `codigo de saida ${result?.code ?? 'desconhecido'}`;
}

function printStderrTail(io, result, url) {
  const stderr = String(result?.stderr || '');
  const masked = !url ? stderr : stderr.split(url).join(maskUrl(url));
  const lines = masked.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-15);
  if (tail.length) {
    io.log('\nUltimas mensagens do FFmpeg:');
    for (const line of tail) io.log(`  ${line}`);
  }
}

function createProgressReporter(io) {
  let time = '';
  let size = '';
  let speed = '';

  return {
    update({ key, value }) {
      if (key === 'out_time') time = String(value).slice(0, 8);
      else if (key === 'total_size') size = formatBytes(value);
      else if (key === 'speed') {
        const s = String(value).trim();
        if (s && s !== 'N/A') speed = s;
      }

      io.onProgress?.({ key, value, time, size, speed });
      if (key === 'progress' || key === 'out_time' || key === 'total_size' || key === 'speed') {
        const parts = ['Baixando...'];
        if (time) parts.push(`Tempo: ${time}`);
        if (size) parts.push(`Tamanho: ${size}`);
        if (speed) parts.push(`Velocidade: ${speed}`);
        io.onStatus?.(parts.join('  '));
      }
    },
    finish() {
      io.onProgressEnd?.();
    },
  };
}

async function chooseVariant(ask, io, variants, masterUrl = '') {
  io.log('\nQualidades encontradas:');
  variants.forEach((v, i) => {
    const label = v.resolution
      ? `${v.resolution}${v.height ? ` (${v.height}p)` : ''}${v.bandwidth ? `  ~${formatKbps(v.bandwidth)}` : ''}`
      : `BANDWIDTH ${v.bandwidth}`;
    io.log(`  ${i + 1}. ${label}`);
  });
  io.log('  0. Cancelar');

  const raw = (await ask('\nEscolha (Enter = melhor disponivel): ')).trim();
  if (raw === '0') return null;

  let index = 1;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= variants.length) {
      index = parsed;
    } else {
      io.log(`[AVISO] Opcao invalida. Usando a melhor disponivel (${variants[0].resolution || 'variante 1'}).`);
    }
  }
  return masterUrl ? new URL(variants[index - 1].uri, masterUrl).toString() : variants[index - 1].uri;
}

function describeSourceType(sourceType) {
  if (sourceType === 'hls') return 'HLS (.m3u8)';
  if (sourceType === 'dash') return 'DASH (.mpd)';
  if (sourceType === 'direct') return 'midia direta';
  if (sourceType === 'youtube') return 'YouTube';
  return 'desconhecido';
}

async function resolveExistingFile(ask, io, output) {
  while (fs.existsSync(output)) {
    io.log(`\n[AVISO] O arquivo ja existe: ${output}`);
    const choice = (await ask('(S)obrescrever, (N)ovo nome, (C)ancelar? ')).trim().toUpperCase();
    if (choice.startsWith('S')) return { action: 'overwrite', output };
    if (choice.startsWith('N')) {
      const newName = await ask('Novo nome do arquivo: ');
      output = path.join(path.dirname(output), ensureMp4(sanitizeFilename(newName)));
      continue;
    }
    return { action: 'cancel', output };
  }
  return { action: 'ok', output };
}

async function runDownloadFlow(ctx, { url, output, headers, extraArgs = [] }) {
  let lastResult = null;

  for (let modeIndex = 0; modeIndex < MODE_LABELS.length; modeIndex++) {
    ctx.io.log(`\nBaixando - modo: ${MODE_LABELS[modeIndex]}`);
    ctx.io.onState?.({ state: `running:${modeIndex}`, label: MODE_LABELS[modeIndex], modeIndex });
    const progress = createProgressReporter(ctx.io);
    const { promise, stop } = startDownload({
      url,
      output,
      headers,
      modeIndex,
      extraArgs,
      onProgress: progress.update,
    });

    ctx.currentFfmpeg = { stop };
    ctx.interruptHandled = false;
    const result = await promise;
    ctx.currentFfmpeg = null;
    progress.finish();

    if (result.ok) {
      return { ok: true, modeIndex };
    }
    if (result.interrupted || ctx.interruptHandled) {
      ctx.io.log('\nDownload interrompido.');
      cleanupPartial(output);
      return { ok: false, interrupted: true };
    }

    lastResult = result;
    const reason = analyzeFailure(result);
    if (reason === '403') {
      print403(ctx.io);
      cleanupPartial(output);
      return { ok: false, error: '403' };
    }

    ctx.io.log(`[AVISO] Falha no modo "${MODE_LABELS[modeIndex]}": ${reason}`);
    if (modeIndex < MODE_LABELS.length - 1) {
      ctx.io.log('Tentando um modo alternativo...');
      ctx.io.onState?.({ state: `retrying:${modeIndex}`, label: MODE_LABELS[modeIndex], modeIndex });
    }
  }

  cleanupPartial(output);
  printStderrTail(ctx.io, lastResult, url);
  return { ok: false, error: 'other' };
}

function rewritePlaylist(text, segMap, keyFiles, mapFiles, baseUrl) {
  return text
    .split(/\r?\n/)
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return '';
      if (!line.startsWith('#')) {
        const resolved = new URL(line, baseUrl).toString();
        const local = segMap.get(resolved);
        return local ? path.basename(local) : line;
      }
      if (line.includes('URI="')) {
        return line.replace(/URI="([^"]*)"/g, (match, u) => {
          const resolved = new URL(u, baseUrl).toString();
          const local = keyFiles.get(resolved) || mapFiles.get(resolved);
          return local ? `URI="${path.basename(local)}"` : match;
        });
      }
      return line;
    })
    .join('\n');
}

const SAFE_SEGMENT_EXT = new Set(['ts', 'mp4', 'm4s', 'm2ts', 'mts', 'aac', 'mp3', 'mov', 'm4a', '3gp', 'mj2', 'vob', 'wav']);

function extForUri(uri, fallback) {
  const m = String(uri).match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i);
  const e = m ? m[1].toLowerCase() : '';
  return SAFE_SEGMENT_EXT.has(e) ? e : fallback;
}

async function runCurlDownloadFlow(ctx, { ask, url, output, headers }) {
  const found = findCurlImpersonate();
  if (!found) {
    printCurlImpHelp(ctx.io);
    return { ok: false, error: 'curl-ausente' };
  }
  ctx.io.log(`\nModo curl-impersonate - usando ${found.name}${found.profile ? ` (perfil ${found.profile})` : ''}.`);

  const client = createCurlClient({ cmd: found.cmd, headers, profile: found.profile });

  let workingUrl = url;
  if (isMdstrmUrl(url) && needsMdstrmRefresh(url)) {
    const videoId = extractMdstrmVideoId(url);
    if (videoId) {
      ctx.io.log(`\n[mdstrm] URL da Media Stream detectada (videoId ${videoId}).`);
      ctx.io.log('[mdstrm] Buscando credenciais do player no embed publico...');
      try {
        const vars = await fetchMdstrmPlayerVars(videoId, client);
        workingUrl = buildPlayerUrl(videoId, vars);
        ctx.io.log(`[mdstrm] URL do player gerada: ${maskUrl(workingUrl)}`);
      } catch (err) {
        ctx.io.log(`[mdstrm] Nao foi possivel converter: ${err.message}`);
        ctx.io.log('[mdstrm] Continuando com a URL original.');
      }
    }
  }

  let masterText;
  let masterFinal;
  try {
    ({ text: masterText, finalUrl: masterFinal } = await client.getText(workingUrl));
  } catch (err) {
    if (err.status === 403) print403(ctx.io);
    else ctx.io.log(`[ERRO] Falha ao obter a playlist: ${err.message}`);
    return { ok: false, error: 'playlist' };
  }

  const info = parsePlaylistText(masterText, masterFinal || workingUrl);
  let targetUrl = workingUrl;
  if (info.kind === 'master' && info.variants.length > 0) {
    const chosen = await chooseVariant(ask, ctx.io, info.variants, info.baseUrl || workingUrl);
    if (!chosen) return { ok: false, error: 'cancelado' };
    targetUrl = chosen;
    ctx.io.log(`Variant escolhida: ${maskUrl(targetUrl)}`);
  } else if (info.kind === 'unknown') {
    ctx.io.log('[AVISO] A playlist nao parece ser HLS padrao. Continuando mesmo assim.');
  }

  let mediaText;
  let mediaFinal;
  try {
    ({ text: mediaText, finalUrl: mediaFinal } = await client.getText(targetUrl));
  } catch (err) {
    if (err.status === 403) print403(ctx.io);
    else ctx.io.log(`[ERRO] Falha ao obter a playlist de segmentos: ${err.message}`);
    return { ok: false, error: 'playlist' };
  }

  const mediaBase = mediaFinal || targetUrl;
  const parsed = parseSegmentPlaylist(mediaText);
  if (!parsed.segments.length) {
    ctx.io.log('\n[ERRO] Nenhum segmento foi encontrado na playlist.');
    return { ok: false, error: 'sem segmentos' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-curl-'));
  ctx.curlimpActive = true;

  try {
    const keyFiles = new Map();
    for (const k of parsed.keys) {
      const keyUrl = new URL(k.uri, mediaBase).toString();
      const local = path.join(tmpDir, `key_${keyFiles.size}.bin`);
      const r = await client.fetch(keyUrl, local);
      if (!r.ok) {
        ctx.io.log('\n[ERRO] Nao foi possivel baixar a chave de criptografia.');
        return { ok: false, error: 'chave' };
      }
      keyFiles.set(keyUrl, local);
    }

    const fallbackExt = parsed.maps.length > 0 ? 'mp4' : 'ts';

    const mapFiles = new Map();
    for (const m of parsed.maps) {
      const mapUrl = new URL(m.uri, mediaBase).toString();
      const local = path.join(tmpDir, `init_${mapFiles.size}.${extForUri(m.uri, 'mp4')}`);
      const r = await client.fetch(mapUrl, local);
      if (!r.ok) {
        ctx.io.log('\n[ERRO] Nao foi possivel baixar o segmento inicial.');
        return { ok: false, error: 'init' };
      }
      mapFiles.set(mapUrl, local);
    }

    const segMap = new Map();
    const queue = parsed.segments.map((s) => ({ url: new URL(s.uri, mediaBase).toString(), uri: s.uri }));
    const total = queue.length;
    let nextIdx = 0;
    let done = 0;
    let failed = 0;
    let totalBytes = 0;

    const renderStatus = () => {
      const msg = `Baixando segmentos: ${done}/${total} (${formatBytes(totalBytes)})${failed ? ` - ${failed} falharam` : ''}`;
      ctx.io.onStatus?.(msg);
      ctx.io.onProgress?.({ key: 'segment_progress', value: `${done}/${total}`, totalBytes, failed });
    };
    renderStatus();

    const worker = async () => {
      while (queue.length) {
        if (ctx.interruptHandled) return;
        const seg = queue.shift();
        const local = path.join(tmpDir, `seg_${String(nextIdx++).padStart(5, '0')}.${extForUri(seg.uri, fallbackExt)}`);
        let r = null;
        for (let attempt = 1; attempt <= 3 && !ctx.interruptHandled; attempt++) {
          r = await client.fetch(seg.url, local);
          if (r.ok) break;
        }
        if (ctx.interruptHandled) return;
        if (r && r.ok) {
          segMap.set(seg.url, local);
          try {
            totalBytes += fs.statSync(local).size;
          } catch {
            /* ignora */
          }
        } else {
          failed++;
        }
        done++;
        renderStatus();
      }
    };

    await Promise.all(Array.from({ length: Math.min(6, total) }, worker));

    if (ctx.interruptHandled) {
      ctx.io.log('\n\nDownload dos segmentos cancelado.');
      return { ok: false, interrupted: true };
    }
    if (failed > 0) {
      ctx.io.log(`\n\n[ERRO] ${failed} de ${total} segmentos falharam. O video esta incompleto; abortando.`);
      return { ok: false, error: 'segmentos' };
    }
    ctx.io.log(`\nSegmentos baixados (${formatBytes(totalBytes)}). Gerando o video com FFmpeg...`);

    const localPlaylist = path.join(tmpDir, 'local.m3u8');
    fs.writeFileSync(localPlaylist, rewritePlaylist(mediaText, segMap, keyFiles, mapFiles, mediaBase), 'utf8');
    const extraArgs = parsed.keys.length > 0 ? ['-allowed_extensions', 'ALL'] : [];

    return await runDownloadFlow(ctx, {
      url: localPlaylist,
      output,
      headers: {},
      extraArgs,
    });
  } finally {
    ctx.curlimpActive = false;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  }
}

function createAnswerSource(answers = {}) {
  return async (question) => {
    if (typeof answers.ask === 'function') return answers.ask(question);
    return answers[question] ?? '';
  };
}

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
  const headers = normalizeHeaders({ ...config.headers, ...parseCliHeaders(argv) });

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
  const adapter = forceYouTube ? resolveSourceAdapter('https://www.youtube.com/watch?v=forced') : resolveSourceAdapter(url);
  const sourceType = adapter.id;
  if (sourceType === 'unknown') {
    safeIo.error('\n[ERRO] A URL nao parece ser uma fonte suportada.');
    safeIo.error('Use uma URL HTTP/HTTPS contendo ".m3u8", ".mpd", um arquivo direto como ".mp4" / ".webm", ou implemente um adaptador especifico.');
    return { code: 1, ok: false };
  }
  safeIo.log(`URL reconhecida: ${maskUrl(url)}`);
  safeIo.log(`Tipo detectado: ${describeSourceType(sourceType)}`);

  let targetUrl = url;
  let info = null;
  if (sourceType === 'youtube') {
    safeIo.onState?.({ state: 'analyzing' });
    safeIo.log('\nAnalisando pagina do YouTube...');
    try {
      info = await adapter.analyze({ url, headers });
      safeIo.log(`Video detectado: ${info.title}`);
      const chosen = await chooseVariant(answerFn, safeIo, info.variants, '');
      if (!chosen) {
        safeIo.log('\nCancelado.');
        return { code: 0, ok: false, cancelled: true };
      }
      targetUrl = chosen;
      safeIo.log(`Formato progressivo escolhido: ${chosen}`);
    } catch (err) {
      safeIo.error(`\n[ERRO] ${err.message}`);
      return { code: 1, ok: false, error: err.code || 'youtube' };
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

  try {
    const prepared = await adapter.prepareDownload({
      url,
      headers,
      output,
      analysis: info,
      selectedUrl: targetUrl,
    });
    targetUrl = prepared?.downloadUrl || targetUrl;
  } catch (err) {
    safeIo.error(`\n[ERRO] ${err.message}`);
    return { code: 1, ok: false, error: err.code || 'prepare-download' };
  }

  const result = useCurlFlag && sourceType === 'hls'
    ? await runCurlDownloadFlow(ctx, { ask: answerFn, url: targetUrl, output, headers })
    : await runDownloadFlow(ctx, { url: targetUrl, output, headers });

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
