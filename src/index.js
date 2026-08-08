import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrompter } from './input.js';
import { checkFfmpeg, startDownload } from './ffmpeg.js';
import { fetchPlaylist, parsePlaylistText, parseSegmentPlaylist } from './hls.js';
import { createCurlClient, findCurlImpersonate, killAllCurl } from './curlimp.js';
import {
  extractMdstrmVideoId,
  fetchMdstrmPlayerVars,
  buildPlayerUrl,
  isMdstrmUrl,
  needsMdstrmRefresh,
} from './mdstrm.js';
import {
  normalizeUrl,
  isValidM3u8Url,
  maskUrl,
  sanitizeFilename,
  ensureMp4,
  getDefaultDownloadsDir,
  formatBytes,
  formatKbps,
  normalizeHeaders,
  getClipboardText,
} from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(PROJECT_ROOT, 'downloads.log');

const MODE_LABELS = [
  'cópia direta (-c copy)',
  'cópia direta com correção de áudio (aac_adtstoasc)',
  'reconversão do áudio para AAC (-c:a aac)',
];

let currentFfmpeg = null;
let interruptHandled = false;
let curlimpActive = false; // true durante o download de segmentos via curl-impersonate

// ---------------------------------------------------------------------------
// Interrupção (Ctrl+C)
// ---------------------------------------------------------------------------
function onInterrupt() {
  if (interruptHandled) return;
  interruptHandled = true;

  if (currentFfmpeg) {
    console.log('\n\nInterrompendo o download... (aguarde)');
    currentFfmpeg.stop();
    return;
  }
  if (curlimpActive) {
    console.log('\n\nCancelando o download dos segmentos... (aguarde)');
    killAllCurl();
    return; // o fluxo detecta interruptHandled e encerra com exit(130)
  }
  console.log('\nOperação cancelada.');
  process.exit(130);
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------
function printHeader() {
  console.log('==============================================');
  console.log('   Video Downloader — HLS (.m3u8)');
  console.log('   via FFmpeg + curl-impersonate (opcional)');
  console.log('==============================================');
}

function printUsage() {
  console.log(`
Video Downloader — HLS (.m3u8) via FFmpeg

Uso:
  npm start
  node src/index.js
  npm run download:curl        # força o modo curl-impersonate

Opções:
  --help                 Mostra esta ajuda
  --referer <URL>        Envia o header Referer ao servidor
  --origin <URL>         Envia o header Origin ao servidor
  --user-agent "<UA>"    Envia o header User-Agent ao servidor
  --curl-impersonate     Usa o curl-impersonate (imita o TLS de um navegador)
                         para contornar CDNs que bloqueiam clientes não-navegador
                         (ex.: mediastre.am / MediastreamCDN)
  --ci                   Atalho para --curl-impersonate

Os headers também podem ser definidos em config.json (veja config.example.json).
`);
}

function printFfmpegHelp() {
  console.log(`
Como instalar o FFmpeg no Windows:
  1. Baixe uma build estável em https://www.gyan.dev/ffmpeg/builds/ (arquivo "release-full").
  2. Extraia o ZIP em uma pasta, por exemplo C:\\ffmpeg.
  3. Adicione a pasta que contém o ffmpeg.exe ao PATH:
     - Painel de Controle → Sistema → Configurações avançadas do sistema
     - Variáveis de Ambiente → em "Path" adicione o caminho da pasta bin.
  4. Abra um novo terminal e teste com: ffmpeg -version
`);
}

function print403() {
  console.error('\n[ERRO 403] A URL foi recusada pelo servidor.');
  console.error('Ela pode ter expirado ou o servidor pode exigir os mesmos headers HTTP utilizados pelo navegador.');
  console.error('Obtenha uma Request URL nova no DevTools e tente novamente.');
  console.error('Se o servidor exigir headers específicos (Referer, Origin, User-Agent),');
  console.error('configure-os em config.json ou use --referer / --origin / --user-agent.');
  console.error('Obs.: alguns CDNs (ex.: mediastre.am) bloqueiam qualquer cliente que não seja um navegador real.');
  console.error('Nesse caso, o modo curl-impersonate (--curl-impersonate) pode contornar o bloqueio.');
}

function printCurlImpHelp() {
  console.log(`
Como instalar o curl-impersonate no Windows:
  1. Acesse https://github.com/lexiforest/curl-impersonate/releases
     (projeto original: https://github.com/lwthiker/curl-impersonate)
     e baixe o pacote para Windows (ex.: curl-impersonate-win64.zip).
  2. Extraia o ZIP em qualquer pasta (ex.: C:\\curl-impersonate).
  3. Copie a pasta que contém o curl_chrome*.exe para uma das opções:
       a) dentro deste projeto:  video-downloader\\tools\\
       b) ou adicione a pasta ao PATH do Windows.
  4. Rode novamente com:  npm run download:curl
`);
}

// ---------------------------------------------------------------------------
// Configuração (headers autorizados fornecidos manualmente)
// ---------------------------------------------------------------------------
function loadConfig() {
  const configPath = path.join(PROJECT_ROOT, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { headers: raw.headers || {} };
    }
  } catch (err) {
    console.log(`[AVISO] config.json inválido: ${err.message}`);
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

// ---------------------------------------------------------------------------
// Auxiliares de exibição / log
// ---------------------------------------------------------------------------

// Substitui a URL completa por sua versão mascarada dentro de textos
// (o FFmpeg ecoa a URL no stderr — nunca exibimos/logamos a URL crua).
function maskInText(text, url) {
  if (!text || !url) return text || '';
  return text.split(url).join(maskUrl(url));
}

function appendLog(entry) {
  try {
    const line = JSON.stringify(entry) + '\n';
    // BOM UTF-8 na primeira escrita: garante que o Windows (PowerShell 5.1)
    // leia o log corretamente (acentos) mesmo sem informar encoding.
    const prefix = fs.existsSync(LOG_FILE) ? '' : '\uFEFF';
    fs.appendFileSync(LOG_FILE, prefix + line, 'utf8');
  } catch {
    /* log é opcional */
  }
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
    return 'incompatibilidade de áudio/container';
  }
  return `código de saída ${result?.code ?? 'desconhecido'}`;
}

function printStderrTail(result, url) {
  const stderr = String(result?.stderr || '');
  const masked = maskInText(stderr, url);
  const lines = masked.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-15);
  if (tail.length) {
    console.log('\nÚltimas mensagens do FFmpeg:');
    for (const l of tail) console.log(`  ${l}`);
  }
}

// ---------------------------------------------------------------------------
// Progresso em tempo real (saída amigável, sem depender de barra perfeita)
// ---------------------------------------------------------------------------
function createProgressReporter() {
  let time = '';
  let size = '';
  let speed = '';
  let lastRender = 0;
  const isTTY = Boolean(process.stdout.isTTY);

  const render = (line) => {
    if (!isTTY) {
      console.log(line);
      return;
    }
    process.stdout.write('\r\x1b[K' + line);
  };

  return {
    update({ key, value }) {
      if (key === 'out_time') time = String(value).slice(0, 8);
      else if (key === 'total_size') size = formatBytes(value);
      else if (key === 'speed') {
        const s = String(value).trim();
        if (s && s !== 'N/A') speed = s;
      }

      const now = Date.now();
      if (now - lastRender > 250 || key === 'progress') {
        lastRender = now;
        const parts = ['Baixando...'];
        if (time) parts.push(`Tempo: ${time}`);
        if (size) parts.push(`Tamanho: ${size}`);
        if (speed) parts.push(`Velocidade: ${speed}`);
        render(parts.join('  '));
      }
    },
    finish() {
      if (isTTY) process.stdout.write('\n');
    },
  };
}

// ---------------------------------------------------------------------------
// Fluxo interativo
// ---------------------------------------------------------------------------
async function chooseVariant(ask, variants, masterUrl) {
  console.log('\nQualidades encontradas:');
  variants.forEach((v, i) => {
    const label = v.resolution
      ? `${v.resolution}${v.height ? ` (${v.height}p)` : ''}${v.bandwidth ? `  ~${formatKbps(v.bandwidth)}` : ''}`
      : `BANDWIDTH ${v.bandwidth}`;
    console.log(`  ${i + 1}. ${label}`);
  });
  console.log('  0. Cancelar');

  const raw = (await ask('\nEscolha (Enter = melhor disponível): ')).trim();
  if (raw === '0') return null;

  let index = 1;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= variants.length) {
      index = parsed;
    } else {
      console.log(`[AVISO] Opção inválida. Usando a melhor disponível (${variants[0].resolution || 'variante 1'}).`);
    }
  }
  // URLs relativas dentro da playlist são resolvidas contra a master.
  return new URL(variants[index - 1].uri, masterUrl).toString();
}

async function resolveExistingFile(ask, output) {
  while (fs.existsSync(output)) {
    console.log(`\n[AVISO] O arquivo já existe: ${output}`);
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

async function runDownloadFlow({ url, output, headers, extraArgs = [] }) {
  let lastResult = null;

  for (let modeIndex = 0; modeIndex < MODE_LABELS.length; modeIndex++) {
    console.log(`\nBaixando — modo: ${MODE_LABELS[modeIndex]}`);
    const progress = createProgressReporter();
    const { promise, stop } = startDownload({
      url,
      output,
      headers,
      modeIndex,
      extraArgs,
      onProgress: progress.update,
    });

    currentFfmpeg = { stop };
    interruptHandled = false;
    const result = await promise;
    currentFfmpeg = null;
    progress.finish();

    if (result.ok) {
      return { ok: true, modeIndex };
    }
    if (result.interrupted) {
      console.log('\nDownload interrompido.');
      cleanupPartial(output);
      return { ok: false, interrupted: true };
    }

    lastResult = result;
    const reason = analyzeFailure(result);
    if (reason === '403') {
      print403();
      cleanupPartial(output);
      return { ok: false, error: '403' };
    }

    console.log(`[AVISO] Falha no modo "${MODE_LABELS[modeIndex]}": ${reason}`);
    if (modeIndex < MODE_LABELS.length - 1) {
      console.log('Tentando um modo alternativo...');
    }
  }

  cleanupPartial(output);
  printStderrTail(lastResult, url);
  return { ok: false, error: 'other' };
}

// ---------------------------------------------------------------------------
// Modo curl-impersonate: contorna CDNs que bloqueiam clientes não-navegador
// (fingerprinting TLS, ex.: mediastre.am). Baixa playlists e segmentos com um
// binário que imita o TLS do Chrome; o FFmpeg entra apenas para remuxar os
// arquivos LOCAIS (sem rede → sem bloqueio). Não contorna DRM e usa apenas a
// URL que o próprio usuário forneceu.
// ---------------------------------------------------------------------------

// Reescreve a playlist de segmentos apontando cada URI para o arquivo local
// baixado (segmentos, chaves AES-128 e init segments do fMP4).
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

// Extensões que o FFmpeg aceita por padrão na lista de segmentos HLS.
// O FFmpeg moderno compara a extensão do arquivo com o formato detectado
// pelo conteúdo (ex.: MPEG-TS → .ts, fMP4 → .mp4/.m4s) — por isso os
// arquivos baixados são nomeados com a extensão correta.
const SAFE_SEGMENT_EXT = new Set(['ts', 'mp4', 'm4s', 'm2ts', 'mts', 'aac', 'mp3', 'mov', 'm4a', '3gp', 'mj2', 'vob', 'wav']);

function extForUri(uri, fallback) {
  const m = String(uri).match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i);
  const e = m ? m[1].toLowerCase() : '';
  return SAFE_SEGMENT_EXT.has(e) ? e : fallback;
}

async function runCurlDownloadFlow({ ask, url, output, headers }) {
  const found = findCurlImpersonate();
  if (!found) {
    printCurlImpHelp();
    return { ok: false, error: 'curl-ausente' };
  }
  console.log(`\nModo curl-impersonate — usando ${found.name}${found.profile ? ` (perfil ${found.profile})` : ''} (imita o TLS de um navegador).`);

  const client = createCurlClient({ cmd: found.cmd, headers, profile: found.profile });

  // 0) mdstrm: se a URL for do CDN (copiada do DevTools) ou do player sem
  // as variáveis de sessão, converte automaticamente para a URL do player,
  // que faz o servidor gerar tokens frescos (a URL crua do CDN dá 403 para
  // tudo — inclusive navegadores reais).
  let workingUrl = url;
  if (isMdstrmUrl(url) && needsMdstrmRefresh(url)) {
    const videoId = extractMdstrmVideoId(url);
    if (videoId) {
      console.log(`\n[mdstrm] URL da Mídia Stream detectada (videoId ${videoId}).`);
      console.log('[mdstrm] Buscando credenciais do player no embed público para gerar tokens frescos...');
      try {
        const vars = await fetchMdstrmPlayerVars(videoId, client);
        workingUrl = buildPlayerUrl(videoId, vars);
        console.log(`[mdstrm] URL do player gerada: ${maskUrl(workingUrl)}`);
      } catch (err) {
        console.log(`[mdstrm] Não foi possível converter: ${err.message}`);
        console.log('[mdstrm] Continuando com a URL original — se der 403, reabra a página do vídeo e tente de novo.');
      }
    }
  }

  // 1) Playlist (master ou já de segmentos)
  let masterText, masterFinal;
  try {
    ({ text: masterText, finalUrl: masterFinal } = await client.getText(workingUrl));
  } catch (err) {
    if (err.status === 403) print403();
    else console.log(`[ERRO] Falha ao obter a playlist: ${err.message}`);
    return { ok: false, error: 'playlist' };
  }

  const info = parsePlaylistText(masterText, masterFinal || workingUrl);
  let targetUrl = workingUrl;
  if (info.kind === 'master' && info.variants.length > 0) {
    const chosen = await chooseVariant(ask, info.variants, info.baseUrl || workingUrl);
    if (!chosen) return { ok: false, error: 'cancelado' };
    targetUrl = chosen;
    console.log(`Variant escolhida: ${maskUrl(targetUrl)}`);
  } else if (info.kind === 'unknown') {
    console.log('[AVISO] A playlist não parece ser HLS padrão. Continuando mesmo assim.');
  }

  // 2) Playlist de segmentos
  let mediaText, mediaFinal;
  try {
    ({ text: mediaText, finalUrl: mediaFinal } = await client.getText(targetUrl));
  } catch (err) {
    if (err.status === 403) print403();
    else console.log(`[ERRO] Falha ao obter a playlist de segmentos: ${err.message}`);
    return { ok: false, error: 'playlist' };
  }
  const mediaBase = mediaFinal || targetUrl;
  const parsed = parseSegmentPlaylist(mediaText);
  if (!parsed.segments.length) {
    console.log('\n[ERRO] Nenhum segmento foi encontrado na playlist.');
    return { ok: false, error: 'sem segmentos' };
  }

  // 3) Diretório temporário para segmentos e playlist local
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-curl-'));
  curlimpActive = true;

  try {
    // 4) Chaves de criptografia (AES-128), se houver
    const keyFiles = new Map();
    for (const k of parsed.keys) {
      const keyUrl = new URL(k.uri, mediaBase).toString();
      const local = path.join(tmpDir, `key_${keyFiles.size}.bin`);
      const r = await client.fetch(keyUrl, local);
      if (!r.ok) {
        console.log('\n[ERRO] Não foi possível baixar a chave de criptografia (AES-128).');
        return { ok: false, error: 'chave' };
      }
      keyFiles.set(keyUrl, local);
    }

    // Extensão dos segmentos conforme o tipo de playlist:
    // fMP4 (tem #EXT-X-MAP) → .mp4 | MPEG-TS → .ts
    const fallbackExt = parsed.maps.length > 0 ? 'mp4' : 'ts';

    // 5) Init segments (EXT-X-MAP) de playlists fMP4, se houver
    const mapFiles = new Map();
    for (const m of parsed.maps) {
      const mapUrl = new URL(m.uri, mediaBase).toString();
      const local = path.join(tmpDir, `init_${mapFiles.size}.${extForUri(m.uri, 'mp4')}`);
      const r = await client.fetch(mapUrl, local);
      if (!r.ok) {
        console.log('\n[ERRO] Não foi possível baixar o segmento inicial (EXT-X-MAP).');
        return { ok: false, error: 'init' };
      }
      mapFiles.set(mapUrl, local);
    }

    // 6) Segmentos (concorrência 6, até 3 tentativas cada)
    const segMap = new Map();
    const queue = parsed.segments.map((s) => ({ url: new URL(s.uri, mediaBase).toString(), uri: s.uri }));
    const total = queue.length;
    let nextIdx = 0;
    let done = 0;
    let failed = 0;
    let totalBytes = 0;
    const isTTY = Boolean(process.stdout.isTTY);
    const renderStatus = () => {
      const msg = `Baixando segmentos: ${done}/${total} (${formatBytes(totalBytes)})${failed ? ` — ${failed} falharam` : ''}`;
      if (isTTY) process.stdout.write('\r\x1b[K' + msg);
      else console.log(msg);
    };
    renderStatus();

    const worker = async () => {
      while (queue.length) {
        if (interruptHandled) return;
        const seg = queue.shift();
        const local = path.join(tmpDir, `seg_${String(nextIdx++).padStart(5, '0')}.${extForUri(seg.uri, fallbackExt)}`);
        let r = null;
        for (let attempt = 1; attempt <= 3 && !interruptHandled; attempt++) {
          r = await client.fetch(seg.url, local);
          if (r.ok) break;
        }
        if (interruptHandled) return;
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

    if (interruptHandled) {
      console.log('\n\nDownload dos segmentos cancelado.');
      return { ok: false, interrupted: true };
    }
    if (failed > 0) {
      console.log(`\n\n[ERRO] ${failed} de ${total} segmentos falharam. O vídeo está incompleto; abortando.`);
      return { ok: false, error: 'segmentos' };
    }
    if (isTTY) process.stdout.write('\n');
    console.log(`\nSegmentos baixados (${formatBytes(totalBytes)}). Gerando o vídeo com FFmpeg...`);

    // 7) Playlist local → FFmpeg remuxa sem tocar na rede.
    // As extensões já são corretas (.ts/.mp4), então o demuxer HLS
    // aceita os arquivos com a lista padrão de extensões.
    // Se houver chaves AES-128 (arquivos .bin), o FFmpeg 9 bloqueia a
    // extensão "não comum" — é preciso liberar com -allowed_extensions ALL
    // como opção de INPUT (antes do -i), via extraArgs.
    const localPlaylist = path.join(tmpDir, 'local.m3u8');
    fs.writeFileSync(
      localPlaylist,
      rewritePlaylist(mediaText, segMap, keyFiles, mapFiles, mediaBase),
      'utf8'
    );

    const extraArgs = parsed.keys.length > 0 ? ['-allowed_extensions', 'ALL'] : [];

    return await runDownloadFlow({
      url: localPlaylist,
      output,
      headers: {},
      extraArgs,
    });
  } finally {
    curlimpActive = false;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return;
  }

  printHeader();

  // Modo curl-impersonate pode ser forçado via flag (ou sugerido ao receber 403).
  let useCurlFlag = argv.includes('--curl-impersonate') || argv.includes('--ci');

  const config = loadConfig();
  const headers = normalizeHeaders({ ...config.headers, ...parseCliHeaders(argv) });

  const prompter = createPrompter();
  prompter.rl.on('SIGINT', onInterrupt);
  const ask = (q) => prompter.ask(q);
  // Fecha o readline antes de sair, para não deixar o terminal em estado estranho.
  const exit = (code) => {
    try {
      prompter.close();
    } catch {
      /* ignora */
    }
    process.exit(code);
  };

  // 1) Verifica o FFmpeg
  console.log('\nVerificando FFmpeg...');
  if (!(await checkFfmpeg())) {
    console.error('\n[ERRO] FFmpeg não foi encontrado no PATH do sistema.');
    printFfmpegHelp();
    exit(1);
  }
  console.log('FFmpeg OK.');

  // 2) URL do .m3u8
  // Se o Enter vier vazio, tenta ler a URL da área de transferência
  // (útil em menus como o ntl, onde o Ctrl+V/colar pode não funcionar).
  let rawUrl = (await ask('\nURL do .m3u8: ')).trim();
  if (!rawUrl) {
    const clip = getClipboardText();
    if (clip) {
      console.log(`[clipboard] URL copiada detectada: ${maskUrl(clip)}`);
      rawUrl = clip;
    }
  }
  const url = normalizeUrl(rawUrl);
  if (!url) {
    console.error('\n[ERRO] Nenhuma URL informada.');
    exit(1);
  }
  if (!isValidM3u8Url(url)) {
    console.error('\n[ERRO] A URL não parece ser uma playlist HLS (.m3u8) válida.');
    console.error('Use uma URL HTTP/HTTPS cujo caminho contenha ".m3u8".');
    exit(1);
  }
  console.log(`URL reconhecida: ${maskUrl(url)}`);

  // 3) Análise da playlist (master x variant) — pulada no modo curl-impersonate
  let targetUrl = url;
  let info = null;
  if (!useCurlFlag) {
    console.log('\nAnalisando playlist...');
    try {
      info = await fetchPlaylist(url, headers);
    } catch (err) {
      if (err.status === 403) {
        print403();
        const ans = (
          await ask('\nO servidor parece bloquear clientes que não sejam navegadores.\nTentar contornar com curl-impersonate (imita o TLS de um navegador real)? (S/n): ')
        )
          .trim()
          .toUpperCase();
        if (ans.startsWith('N')) exit(1);
        useCurlFlag = true;
        console.log('\nAtivando o modo curl-impersonate...');
      } else {
        console.log(`[AVISO] Não foi possível analisar a playlist (${err.message}).`);
        console.log('O download tentará usar a URL fornecida diretamente.');
      }
    }

    if (!useCurlFlag && info?.kind === 'master' && info.variants.length > 0) {
      const chosen = await chooseVariant(ask, info.variants, info.baseUrl || url);
      if (!chosen) {
        console.log('\nCancelado.');
        exit(0);
      }
      targetUrl = chosen;
      console.log(`Variant escolhida: ${maskUrl(targetUrl)}`);
    } else if (!useCurlFlag && info?.kind === 'unknown') {
      console.log('[AVISO] A playlist não parece ser HLS padrão. Continuando mesmo assim.');
    }
  }
  // kind === 'media' → a URL fornecida já é a variant; usa diretamente.

  // 4) Nome do arquivo
  const rawName = await ask('\nNome do arquivo (sem extensão): ');
  const fileName = ensureMp4(sanitizeFilename(rawName));

  // 5) Pasta de saída (padrão: Downloads do usuário)
  const defaultDir = getDefaultDownloadsDir();
  const rawDir = await ask(`Pasta de saída (Enter = ${defaultDir}): `);
  const dir = rawDir.trim() ? path.resolve(rawDir.trim()) : defaultDir;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`\n[ERRO] Não foi possível usar a pasta "${dir}": ${err.message}`);
    exit(1);
  }

  // 6) Conflito com arquivo existente
  let output = path.join(dir, fileName);
  const resolved = await resolveExistingFile(ask, output);
  if (resolved.action === 'cancel') {
    console.log('\nCancelado.');
    exit(0);
  }
  output = resolved.output;

  console.log(`\nSalvando em: ${output}`);

  // 7) Download — modo normal (FFmpeg direto) ou modo curl-impersonate
  let result;
  if (useCurlFlag) {
    result = await runCurlDownloadFlow({ ask, url: targetUrl, output, headers });
    if (result?.error === 'cancelado') {
      console.log('\nCancelado.');
      exit(0);
    }
    if (result?.error === 'curl-ausente') exit(1);
  } else {
    result = await runDownloadFlow({ url: targetUrl, output, headers });
  }

  if (result.ok) {
    console.log('\n✅ Download concluído!');
    console.log(`Arquivo salvo em: ${output}`);
    appendLog({
      date: new Date().toISOString(),
      file: path.basename(output),
      url: maskUrl(targetUrl),
      mode: MODE_LABELS[result.modeIndex],
      ok: true,
    });
    exit(0);
  }

  appendLog({
    date: new Date().toISOString(),
    file: path.basename(output),
    url: maskUrl(targetUrl),
    ok: false,
    reason: result.interrupted ? 'interrompido' : result.error || 'falha',
  });

  if (result.interrupted) {
    exit(130);
  }

  console.log('\nO download não pôde ser concluído. Revise a URL (talvez o token tenha expirado) e tente novamente.');
  exit(1);
}

process.on('SIGINT', onInterrupt);

main().catch((err) => {
  console.error('\n[ERRO inesperado]', err && err.stack ? err.stack : err);
  process.exit(1);
});
