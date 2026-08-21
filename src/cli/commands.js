import fs from 'node:fs';
import path from 'node:path';

import { createStreamGrabCore } from '../core/index.js';
import { fetchPlaylist } from '../hls.js';
import { resolveSourceAdapterAsync } from '../source-adapters.js';
import {
  normalizeUrl,
  normalizeHeaders,
  sanitizeFilename,
  ensureMp4,
  getDefaultDownloadsDir,
} from '../utils.js';
import { ADAPTIVE_URI_PREFIX } from '../adapters/ytdlp.js';
import { loadConfig, parseCliHeaders, parseCliAuth } from './config.js';
import { runCliSession } from '../cli-flow.js';
import { runDownloadFlow } from './download.js';
import { createContext } from './context.js';
import { renderAnalysis, printAnalysisError } from './render.js';

export function parseCliCommand(argv = []) {
  const first = argv[0];
  if (first === 'analyze' || first === 'download') {
    return { command: first, url: argv[1] || '', rest: argv.slice(2) };
  }
  if (first === 'help') {
    return { command: 'help', url: '', rest: argv.slice(1) };
  }
  return { command: 'interactive', url: '', rest: argv };
}

export function printSubcommandHelp(io) {
  io.log('');
  io.log('StreamGrab - CLI nao-interativa');
  io.log('');
  io.log('Uso:');
  io.log('  streamgrab <url>                    Fluxo interativo (padrao)');
  io.log('  streamgrab analyze <url> [--json]   Analisa a URL sem interacao');
  io.log('  streamgrab download <url> [opcoes]  Baixa a URL sem interacao');
  io.log('');
  io.log('Opcoes do analyze:');
  io.log('  --json                       Saida em JSON (machine-readable)');
  io.log('  --cookies <arquivo>          cookies.txt (Netscape)');
  io.log('  --cookies-from-browser <b>   Extrai cookies do navegador');
  io.log('  --referer <url>              Header Referer');
  io.log('  --user-agent <ua>            Header User-Agent');
  io.log('');
  io.log('Opcoes do download:');
  io.log('  --output <dir>               Pasta de saida (padrao: Downloads)');
  io.log('  --filename <nome>            Nome do arquivo (sem extensao)');
  io.log('  --format <n|id>              Qualidade: indice 1..n ou formatId (ex.: 137)');
  io.log('  --audio-only                 Baixa apenas o audio');
  io.log('  --audio-lang <code>          Idioma do audio (ex: pt, en). Default: melhor disponivel');
  io.log('  --all-audio                  Baixa todas as faixas de audio (mux multi-audio)');
  io.log('  --subs <lang1,lang2>         Baixar legendas (ex: pt,en). --subs all = todas');
  io.log('  --embed-subs                 Embutir legendas no video (hardcoded)');
  io.log('  --turbo                      Download paralelo por partes (URLs diretas)');
  io.log('  --chunks <n>                 Conexoes do turbo (padrao: 8)');
  io.log('  --concurrency <n>            Alias mais claro para --chunks');
  io.log('  --no-resume                  Desliga resume do turbo (descarta parcial)');
  io.log('  --cookies <arquivo>          cookies.txt (Netscape)');
  io.log('  --cookies-from-browser <b>   Extrai cookies do navegador');
  io.log('  --curl-impersonate           Forca o modo curl-impersonate para HLS');
  io.log('  --referer <url>              Header Referer');
  io.log('  --user-agent <ua>            Header User-Agent');
}

export function parseAnalyzeFlags(rest = []) {
  return {
    json: rest.includes('--json'),
    headers: parseCliHeaders(rest),
    auth: parseCliAuth(rest),
  };
}

export function parseDownloadFlags(rest = []) {
  const flags = {
    outputDir: '',
    filename: '',
    format: '',
    audioOnly: false,
    audioLanguage: '',
    allAudio: false,
    subLanguages: [],
    embedSubs: false,
    turbo: false,
    chunks: 0,
    noResume: false,
    forceCurl: false,
    cookiesFile: '',
    cookiesFromBrowser: '',
    headers: {},
  };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--output' || arg === '-o') flags.outputDir = rest[++i] || '';
    else if (arg === '--filename') flags.filename = rest[++i] || '';
    else if (arg === '--format' || arg === '-f') flags.format = rest[++i] || '';
    else if (arg === '--audio-only') flags.audioOnly = true;
    else if (arg === '--audio-lang') flags.audioLanguage = rest[++i] || '';
    else if (arg === '--all-audio') flags.allAudio = true;
    else if (arg === '--subs') {
      const val = rest[++i] || '';
      flags.subLanguages = val === 'all' ? ['all'] : val.split(',').map((s) => s.trim()).filter(Boolean);
    }
    else if (arg === '--embed-subs') flags.embedSubs = true;
    else if (arg === '--turbo') flags.turbo = true;
    else if (arg === '--chunks') flags.chunks = Number(rest[++i]) || 0;
    else if (arg === '--no-resume') flags.noResume = true;
    else if (arg === '--curl-impersonate' || arg === '--ci') flags.forceCurl = true;
    else if (arg === '--cookies') flags.cookiesFile = rest[++i] || '';
    else if (arg === '--cookies-from-browser') flags.cookiesFromBrowser = rest[++i] || '';
  }
  flags.headers = parseCliHeaders(rest);
  return flags;
}

export async function runAnalyzeCommand({ url, projectRoot, io = console, flags = {} }) {
  const target = normalizeUrl(url);
  if (!target || !isValidHttpUrl(target)) {
    io.error('\n[ERRO] URL invalida. Uso: streamgrab analyze <url>');
    return { code: 1, ok: false };
  }

  const config = loadConfig(projectRoot, io);
  const headers = normalizeHeaders({ ...config.headers, ...(flags.headers || {}) });
  const auth = {
    cookiesFile: flags.cookiesFile || config.cookiesFile || '',
    cookiesFromBrowser: flags.cookiesFromBrowser || config.cookiesFromBrowser || '',
  };

  const core = createStreamGrabCore();
  const adapter = await resolveSourceAdapterAsync(target, headers);
  const sourceType = adapter.id;
  if (sourceType === 'unknown') {
    io.error('\n[ERRO] A URL nao parece ser uma fonte suportada.');
    return { code: 1, ok: false, error: 'UNSUPPORTED_SOURCE' };
  }

  let info;
  try {
    if (sourceType === 'youtube' || sourceType === 'social') {
      const analysis = await core.analyze(target, { headers, auth });
      info = analysis.info;
    } else if (sourceType === 'hls') {
      info = await fetchPlaylist(target, headers);
    } else if (sourceType === 'dash') {
      info = await adapter.analyze({ url: target, headers });
    } else {
      info = { kind: 'direct', totalDuration: 0 };
    }
  } catch (err) {
    printAnalysisError(io, err);
    return { code: 1, ok: false, error: err };
  }

  renderAnalysis(io, { url: target, adapter, info, json: flags.json === true });
  return { code: 0, ok: true, info, sourceType };
}

export async function runDownloadCommand({ url, projectRoot, io = console, options = {} }) {
  const target = normalizeUrl(url);
  if (!target || !isValidHttpUrl(target)) {
    io.error('\n[ERRO] URL invalida. Uso: streamgrab download <url>');
    return { code: 1, ok: false };
  }

  const config = loadConfig(projectRoot, io);
  const headers = normalizeHeaders({ ...config.headers, ...(options.headers || {}) });
  const auth = {
    cookiesFile: options.cookiesFile || config.cookiesFile || '',
    cookiesFromBrowser: options.cookiesFromBrowser || config.cookiesFromBrowser || '',
  };

  if (options.audioOnly) {
    return runAudioOnlyFlow({ target, io, headers, auth, options });
  }

  let qualityChoice = '';
  if (options.format) {
    const resolved = await resolveQualityChoice({ target, headers, auth, format: options.format, io });
    if (resolved.error) return { code: 1, ok: false, error: resolved.error };
    qualityChoice = resolved.qualityChoice;
  }

  const answers = createNonInteractiveAnswers({
    url: target,
    filename: options.filename,
    outputDir: options.outputDir,
    qualityChoice,
    forceCurl: options.forceCurl,
  });
  const argv = buildDownloadArgv({ options, auth });

  return runCliSession({ argv, projectRoot, ask: answers.ask, io });
}

export function createNonInteractiveAnswers({ url, filename = '', outputDir = '', qualityChoice = '', forceCurl = false }) {
  const baseName = filename ? sanitizeFilename(filename) : 'video';
  return {
    async ask(question) {
      if (question.includes('URL do video/playlist')) return String(url || '');
      if (question.includes('Escolha (Enter = melhor disponivel)')) return String(qualityChoice || '');
      if (question.includes('Nome do arquivo')) return baseName;
      if (question.includes('Pasta de saida')) return String(outputDir || '');
      if (question.includes('(S)obrescrever, (N)ovo nome, (C)ancelar?')) return 'S';
      if (question.includes('Tentar contornar com curl-impersonate')) return forceCurl ? 'S' : '';
      return '';
    },
  };
}

export function buildDownloadArgv({ options = {}, auth = {} }) {
  const argv = [];
  if (options.turbo) argv.push('--turbo');
  if (options.chunks > 0) argv.push('--chunks', String(options.chunks));
  if (options.noResume) argv.push('--no-resume');
  if (options.forceCurl) argv.push('--curl-impersonate');
  if (auth.cookiesFile) argv.push('--cookies', auth.cookiesFile);
  if (auth.cookiesFromBrowser) argv.push('--cookies-from-browser', auth.cookiesFromBrowser);
  return argv;
}

export async function resolveQualityChoice({ target, headers, auth = {}, format = '', io = console }) {
  if (!format) return { qualityChoice: '', error: null };

  const core = createStreamGrabCore();
  const adapter = await resolveSourceAdapterAsync(target, headers);
  let info = null;
  if (adapter.id === 'youtube' || adapter.id === 'social') {
    const analysis = await core.analyze(target, { headers, auth });
    info = analysis.info;
  } else if (adapter.id === 'hls') {
    info = await fetchPlaylist(target, headers);
  }

  const variants = info?.variants || [];
  const byId = variants.findIndex((v) => {
    if (v.formatId && String(v.formatId) === format) return true;
    if (v.uri === `${ADAPTIVE_URI_PREFIX}${format}`) return true;
    if (v.itag && String(v.itag) === format) return true;
    if (v.height && String(v.height) === format) return true;
    if (v.bandwidth && String(v.bandwidth) === format) return true;
    return false;
  });
  if (byId !== -1) return { qualityChoice: String(byId + 1), error: null };

  const numeric = Number(format);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= variants.length) {
    return { qualityChoice: String(numeric), error: null };
  }

  io.error(`\n[ERRO] Formato "${format}" nao encontrado. Use um indice (1..${variants.length}) ou um formatId da analise.`);
  return { qualityChoice: '', error: 'formato-nao-encontrado' };
}

async function runAudioOnlyFlow({ target, io = console, headers, auth, options }) {
  const core = createStreamGrabCore();
  const adapter = await resolveSourceAdapterAsync(target, headers);
  const sourceType = adapter.id;
  if (sourceType === 'unknown') {
    io.error('\n[ERRO] A URL nao parece ser uma fonte suportada.');
    return { code: 1, ok: false, error: 'UNSUPPORTED_SOURCE' };
  }

  const filename = options.filename ? sanitizeFilename(options.filename) : 'audio';
  const dir = options.outputDir ? path.resolve(options.outputDir) : getDefaultDownloadsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    io.error(`\n[ERRO] Nao foi possivel usar a pasta "${dir}": ${err.message}`);
    return { code: 1, ok: false };
  }

  const ctx = createContext(io);
  let url = target;
  let output;
  let totalBytes;
  let durationMs;
  let outputArgs = [];

  if (sourceType === 'youtube' || sourceType === 'social') {
    let info;
    try {
      const analysis = await core.analyze(target, { headers, auth });
      info = analysis.info;
    } catch (err) {
      printAnalysisError(io, err);
      return { code: 1, ok: false, error: err };
    }
    const audio = info.adaptiveAudioFormats?.[0] || info.progressiveFormats?.[0];
    if (!audio?.url) {
      io.error('\n[ERRO] Nenhum audio encontrado para esta URL.');
      return { code: 1, ok: false, error: 'sem-audio' };
    }
    url = audio.url;
    const ext = audio.container || 'm4a';
    output = path.join(dir, ensureExt(filename, ext));
    totalBytes = audio.contentLength || undefined;
    durationMs = (info.durationSeconds || 0) * 1000;
    io.log(`\nExtraindo audio (${ext}, ${audio.qualityLabel || 'melhor disponivel'})...`);
  } else {
    output = path.join(dir, ensureMp4(filename));
    outputArgs = ['-vn', '-c:a', 'copy'];
    io.log('\nExtraindo audio (FFmpeg -vn -c:a copy)...');
  }

  const result = await runDownloadFlow(ctx, { url, output, headers, totalBytes, durationMs, outputArgs });
  if (result.ok) {
    io.log('\nDownload concluido!');
    io.log(`Arquivo salvo em: ${output}`);
    return { code: 0, ok: true, output };
  }
  if (result.interrupted) return { code: 130, ok: false, interrupted: true };
  io.log('\nO download nao pode ser concluido. Revise a URL e tente novamente.');
  return { code: 1, ok: false, error: result.error || 'falha' };
}

export function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ensureExt(name, ext) {
  const safe = String(ext || '').replace(/^\./, '');
  if (!safe) return name;
  const re = new RegExp(`\\.${safe}$`, 'i');
  return re.test(name) ? name : `${name}.${safe}`;
}
