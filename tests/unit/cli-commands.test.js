// P9 — CLI evoluída (seção 44): subcomandos `analyze` e `download` sem
// interação (stdin não usado), exit codes 0/1/130 e compatibilidade das
// flags antigas. Mesmo padrão de mocks do cli-flow-core.test.js:
// youtube-dl-exec mockado + fachada ffmpeg/muxer mockadas + hls.js mockado.
// O StreamGrabCore é REAL (strangler: runCliSession -> core.analyze ->
// adapter youtube -> yt-dlp mock -> MediaInfo -> download).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mock } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(os.tmpdir(), 'vd-cli-commands-test');
const FFMPEG_URL = pathToFileURL(path.join(ROOT, 'src', 'ffmpeg.js')).href;
const MUXER_URL = pathToFileURL(path.join(ROOT, 'src', 'ffmpeg', 'muxer.js')).href;
const HLS_URL = pathToFileURL(path.join(ROOT, 'src', 'hls.js')).href;

let fakeYtDlpImpl = null;
mock.module('youtube-dl-exec', {
  namedExports: {
    youtubeDl: async (...args) => fakeYtDlpImpl(...args),
  },
});

const fakeCalls = { startDownload: 0, startMuxDownload: 0 };
function fakeStartDownload({ output }) {
  fakeCalls.startDownload++;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, 'fake-mp4');
  return { promise: Promise.resolve({ ok: true }), stop: () => {} };
}
function fakeStartMuxDownload({ output }) {
  fakeCalls.startMuxDownload++;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, 'fake-muxed-mp4');
  return { promise: Promise.resolve({ ok: true }), stop: () => {} };
}
mock.module(FFMPEG_URL, {
  namedExports: {
    checkFfmpeg: () => Promise.resolve(true),
    getFfmpegCommand: () => 'ffmpeg',
    startDownload: fakeStartDownload,
    startMuxDownload: fakeStartMuxDownload,
  },
});
mock.module(MUXER_URL, {
  namedExports: {
    MODE_LABELS: [
      'copia direta (-c copy)',
      'copia direta com correcao de audio (aac_adtstoasc)',
      'reconversao do audio para AAC (-c:a aac)',
    ],
    startDownload: fakeStartDownload,
    startMuxDownload: fakeStartMuxDownload,
    mux: fakeStartMuxDownload,
  },
});

/** Info do HLS master (mock de src/hls.js — fetchPlaylist). */
const HLS_INFO = {
  kind: 'master',
  sourceType: 'hls',
  provider: 'hls',
  baseUrl: 'https://cdn.example/master.m3u8',
  variants: [
    {
      uri: 'https://cdn.example/720p.m3u8',
      resolution: '1280x720',
      height: 720,
      bandwidth: 2000000,
      codecs: 'avc1.4d001f,mp4a.40.2',
    },
  ],
};
mock.module(HLS_URL, {
  namedExports: {
    parseAttributes: () => ({}),
    parsePlaylistText: () => null,
    fetchPlaylistText: async () => '',
    fetchPlaylist: async () => HLS_INFO,
    parseSegmentPlaylist: () => null,
  },
});

/** JSON do yt-dlp minimo: 1 formato progressivo (itag 18). */
const YT_DLP_SINGLE = {
  id: 'abc123',
  title: 'Video de Teste P9',
  duration: 30,
  formats: [
    {
      format_id: '18',
      url: 'https://cdn.example/prog.mp4',
      vcodec: 'avc1.42001E',
      acodec: 'mp4a.40.2',
      ext: 'mp4',
      width: 640,
      height: 360,
      tbr: 500,
      filesize: 1000,
    },
  ],
};

/** JSON do yt-dlp: video adaptativo 1080p + audio m4a (fluxo mux). */
const YT_DLP_MUX = {
  id: 'abc123',
  title: 'Video Mux P9',
  duration: 30,
  formats: [
    {
      format_id: '137',
      url: 'https://cdn.example/v137.mp4',
      vcodec: 'avc1.640028',
      acodec: 'none',
      ext: 'mp4',
      width: 1920,
      height: 1080,
      tbr: 2500,
      filesize: 1000000,
    },
    {
      format_id: '140',
      url: 'https://cdn.example/a140.m4a',
      vcodec: 'none',
      acodec: 'mp4a.40.2',
      ext: 'm4a',
      abr: 128,
      filesize: 500000,
    },
  ],
};

const YOUTUBE_URL = 'https://www.youtube.com/watch?v=abc123';
const HLS_URL_MASTER = 'https://cdn.example/master.m3u8';

function makeIo() {
  const lines = [];
  return {
    lines,
    log: (...a) => lines.push(a.join(' ')),
    error: (...a) => lines.push(a.join(' ')),
  };
}

const NOOP_IO = { log: () => {}, error: () => {}, onState: () => {} };

// ---------------------------------------------------------------------------
// analyze — sem interação (stdin não usado)
// ---------------------------------------------------------------------------

test('P9 analyze: youtube exit 0 e saída textual com qualidades', async () => {
  fakeYtDlpImpl = async () => YT_DLP_SINGLE;
  const { runAnalyzeCommand } = await import(`../../src/cli/commands.js?p9-an-text=${Date.now()}`);
  const io = makeIo();
  const result = await runAnalyzeCommand({ url: YOUTUBE_URL, projectRoot: ROOT, io, flags: {} });

  assert.equal(result.code, 0, `exit code 0 (foi ${result.code})`);
  assert.equal(result.ok, true);
  assert.equal(result.sourceType, 'youtube');
  assert.equal(result.info.title, 'Video de Teste P9');
  const text = io.lines.join('\n');
  assert.match(text, /Tipo:/, 'linha Tipo impressa');
  assert.match(text, /Video de Teste P9/, 'titulo impresso');
  assert.match(text, /360p/, 'qualidade 360p listada');
});

test('P9 analyze: --json gera JSON parseável com variantes', async () => {
  fakeYtDlpImpl = async () => YT_DLP_SINGLE;
  const { runAnalyzeCommand } = await import(`../../src/cli/commands.js?p9-an-json=${Date.now()}`);
  const io = makeIo();
  const result = await runAnalyzeCommand({ url: YOUTUBE_URL, projectRoot: ROOT, io, flags: { json: true } });

  assert.equal(result.code, 0);
  const parsed = JSON.parse(io.lines.join('\n'));
  assert.equal(parsed.url, YOUTUBE_URL);
  assert.equal(parsed.sourceType, 'youtube');
  assert.equal(parsed.provider, 'YouTube (yt-dlp)');
  assert.equal(parsed.title, 'Video de Teste P9');
  assert.equal(parsed.durationSeconds, 30);
  assert.ok(Array.isArray(parsed.variants), 'variants é lista');
  assert.equal(parsed.variants.length, 1);
  assert.equal(parsed.variants[0].height, 360);
});

test('P9 analyze: HLS exit 0 com variantes e rótulo HLS', async () => {
  const { runAnalyzeCommand } = await import(`../../src/cli/commands.js?p9-an-hls=${Date.now()}`);
  const io = makeIo();
  const result = await runAnalyzeCommand({ url: HLS_URL_MASTER, projectRoot: ROOT, io, flags: {} });

  assert.equal(result.code, 0, `exit code 0 (foi ${result.code})`);
  assert.equal(result.sourceType, 'hls');
  const text = io.lines.join('\n');
  assert.match(text, /HLS \(\.m3u8\)/, 'tipo HLS');
  assert.match(text, /Qualidades \(1\):/, 'lista de qualidades');
  assert.match(text, /1280x720/, 'resolucao 1280x720 listada');
});

test('P9 analyze: erro do yt-dlp → exit 1 + [ERRO]', async () => {
  fakeYtDlpImpl = async () => {
    const err = new Error('Request failed: 403 Forbidden');
    err.stderr = 'ERROR: unable to download video data: HTTP Error 403: Forbidden';
    throw err;
  };
  const { runAnalyzeCommand } = await import(`../../src/cli/commands.js?p9-an-err=${Date.now()}`);
  const io = makeIo();
  const result = await runAnalyzeCommand({ url: YOUTUBE_URL, projectRoot: ROOT, io, flags: {} });

  assert.equal(result.code, 1, `exit code 1 (foi ${result.code})`);
  assert.equal(result.ok, false);
  assert.match(io.lines.join('\n'), /\[ERRO\]/, 'mensagem de erro impressa');
});

test('P9 analyze: URL inválida → exit 1', async () => {
  const { runAnalyzeCommand } = await import(`../../src/cli/commands.js?p9-an-bad=${Date.now()}`);
  const io = makeIo();
  const result = await runAnalyzeCommand({ url: 'http://', projectRoot: ROOT, io, flags: {} });

  assert.equal(result.code, 1);
  assert.equal(result.ok, false);
  assert.match(io.lines.join('\n'), /URL invalida/);
});

test('P9 analyze: fonte desconhecida → exit 1', async () => {
  const { runAnalyzeCommand } = await import(`../../src/cli/commands.js?p9-an-unk=${Date.now()}`);
  const io = makeIo();
  const result = await runAnalyzeCommand({ url: 'https://example.com/pagina.html', projectRoot: ROOT, io, flags: {} });

  assert.equal(result.code, 1);
  assert.equal(result.ok, false);
  assert.match(io.lines.join('\n'), /fonte suportada/);
});

// ---------------------------------------------------------------------------
// download — sem interação (stdin não usado)
// ---------------------------------------------------------------------------

test('P9 download: youtube single exit 0 e arquivo salvo', async () => {
  fakeYtDlpImpl = async () => YT_DLP_SINGLE;
  fakeCalls.startDownload = 0;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const { runDownloadCommand } = await import(`../../src/cli/commands.js?p9-dl-single=${Date.now()}`);
  const io = makeIo();
  const result = await runDownloadCommand({
    url: YOUTUBE_URL,
    projectRoot: ROOT,
    io,
    options: { outputDir: OUT_DIR, filename: 'p9-download' },
  });

  assert.equal(result.code, 0, `exit code 0 (foi ${result.code})`);
  assert.equal(result.ok, true);
  assert.equal(fakeCalls.startDownload, 1, 'download unico executado');
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'p9-download.mp4')), 'arquivo de saida gravado');
});

test('P9 download: youtube adaptativo usa mux (exit 0)', async () => {
  fakeYtDlpImpl = async () => YT_DLP_MUX;
  fakeCalls.startDownload = 0;
  fakeCalls.startMuxDownload = 0;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const { runDownloadCommand } = await import(`../../src/cli/commands.js?p9-dl-mux=${Date.now()}`);
  const io = makeIo();
  const result = await runDownloadCommand({
    url: YOUTUBE_URL,
    projectRoot: ROOT,
    io,
    options: { outputDir: OUT_DIR, filename: 'p9-mux' },
  });

  assert.equal(result.code, 0, `exit code 0 (foi ${result.code})`);
  assert.equal(fakeCalls.startDownload, 2, 'video + audio baixados');
  assert.equal(fakeCalls.startMuxDownload, 1, 'mux executado');
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'p9-mux.mp4')), 'arquivo muxado gravado');
});

test('P9 download: --format <itag> resolve a variante (exit 0)', async () => {
  fakeYtDlpImpl = async () => YT_DLP_SINGLE;
  fakeCalls.startDownload = 0;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const { runDownloadCommand } = await import(`../../src/cli/commands.js?p9-dl-fmt=${Date.now()}`);
  const io = makeIo();
  const result = await runDownloadCommand({
    url: YOUTUBE_URL,
    projectRoot: ROOT,
    io,
    options: { outputDir: OUT_DIR, filename: 'p9-fmt', format: '18' },
  });

  assert.equal(result.code, 0, `exit code 0 (foi ${result.code})`);
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'p9-fmt.mp4')), 'arquivo gravado');
});

test('P9 download: --format inexistente → exit 1', async () => {
  fakeYtDlpImpl = async () => YT_DLP_SINGLE;
  const { runDownloadCommand } = await import(`../../src/cli/commands.js?p9-dl-fmtbad=${Date.now()}`);
  const io = makeIo();
  const result = await runDownloadCommand({
    url: YOUTUBE_URL,
    projectRoot: ROOT,
    io,
    options: { format: 'nao-existe' },
  });

  assert.equal(result.code, 1, `exit code 1 (foi ${result.code})`);
  assert.match(io.lines.join('\n'), /nao encontrado/);
});

test('P9 download: URL inválida → exit 1', async () => {
  const { runDownloadCommand } = await import(`../../src/cli/commands.js?p9-dl-bad=${Date.now()}`);
  const io = makeIo();
  const result = await runDownloadCommand({ url: 'not-a-url', projectRoot: ROOT, io, options: {} });

  assert.equal(result.code, 1);
  assert.match(io.lines.join('\n'), /URL invalida/);
});

test('P9 download --audio-only: youtube extrai áudio m4a (exit 0)', async () => {
  fakeYtDlpImpl = async () => YT_DLP_MUX;
  fakeCalls.startDownload = 0;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const { runDownloadCommand } = await import(`../../src/cli/commands.js?p9-dl-audio=${Date.now()}`);
  const io = makeIo();
  const result = await runDownloadCommand({
    url: YOUTUBE_URL,
    projectRoot: ROOT,
    io,
    options: { outputDir: OUT_DIR, filename: 'p9-audio', audioOnly: true },
  });

  assert.equal(result.code, 0, `exit code 0 (foi ${result.code})`);
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'p9-audio.m4a')), 'audio m4a gravado');
});

test('P9 download --audio-only: HLS extrai com -vn (exit 0)', async () => {
  fakeCalls.startDownload = 0;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const { runDownloadCommand } = await import(`../../src/cli/commands.js?p9-dl-audiohls=${Date.now()}`);
  const io = makeIo();
  const result = await runDownloadCommand({
    url: HLS_URL_MASTER,
    projectRoot: ROOT,
    io,
    options: { outputDir: OUT_DIR, filename: 'p9-audio-hls', audioOnly: true },
  });

  assert.equal(result.code, 0, `exit code 0 (foi ${result.code})`);
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'p9-audio-hls.mp4')), 'audio hls gravado');
});

// ---------------------------------------------------------------------------
// Helpers de parse (units)
// ---------------------------------------------------------------------------

test('P9 parseCliCommand: detecta subcomandos sem quebrar o legado', async () => {
  const { parseCliCommand } = await import(`../../src/cli/commands.js?p9-parse=${Date.now()}`);

  assert.deepEqual(parseCliCommand(['analyze', 'https://x.m3u8', '--json']), {
    command: 'analyze',
    url: 'https://x.m3u8',
    rest: ['--json'],
  });
  assert.deepEqual(parseCliCommand(['download', 'https://x.m3u8', '--turbo']), {
    command: 'download',
    url: 'https://x.m3u8',
    rest: ['--turbo'],
  });
  assert.equal(parseCliCommand(['help']).command, 'help');
  // Flags antigas na posição 0 continuam no fluxo interativo (compat).
  assert.equal(parseCliCommand(['--turbo']).command, 'interactive');
  assert.equal(parseCliCommand(['--youtube']).command, 'interactive');
  assert.equal(parseCliCommand([]).command, 'interactive');
  assert.equal(parseCliCommand([YOUTUBE_URL]).command, 'interactive');
});

test('P9 parseDownloadFlags: mapeia opções escalares e booleanas', async () => {
  const { parseDownloadFlags } = await import(`../../src/cli/commands.js?p9-pdf=${Date.now()}`);
  const flags = parseDownloadFlags([
    '--output', 'D:/videos',
    '--filename', 'meu-video',
    '--format', '137',
    '--audio-only',
    '--turbo',
    '--chunks', '4',
    '--cookies', 'cookies.txt',
    '--curl-impersonate',
  ]);

  assert.equal(flags.outputDir, 'D:/videos');
  assert.equal(flags.filename, 'meu-video');
  assert.equal(flags.format, '137');
  assert.equal(flags.audioOnly, true);
  assert.equal(flags.turbo, true);
  assert.equal(flags.chunks, 4);
  assert.equal(flags.cookiesFile, 'cookies.txt');
  assert.equal(flags.forceCurl, true);
});

test('P9 resolveQualityChoice: itag, altura e índice', async () => {
  fakeYtDlpImpl = async () => YT_DLP_SINGLE;
  const { resolveQualityChoice } = await import(`../../src/cli/commands.js?p9-rqc=${Date.now()}`);

  const byItag = await resolveQualityChoice({ target: YOUTUBE_URL, headers: {}, format: '18' });
  assert.equal(byItag.qualityChoice, '1');
  assert.equal(byItag.error, null);

  const byHeight = await resolveQualityChoice({ target: YOUTUBE_URL, headers: {}, format: '360' });
  assert.equal(byHeight.qualityChoice, '1');

  const byIndex = await resolveQualityChoice({ target: YOUTUBE_URL, headers: {}, format: '1' });
  assert.equal(byIndex.qualityChoice, '1');

  const bad = await resolveQualityChoice({ target: YOUTUBE_URL, headers: {}, format: '9999' });
  assert.equal(bad.error, 'formato-nao-encontrado');
});

test('P9 createNonInteractiveAnswers: respostas pré-preenchidas', async () => {
  const { createNonInteractiveAnswers } = await import(`../../src/cli/commands.js?p9-answers=${Date.now()}`);
  const answers = createNonInteractiveAnswers({
    url: 'https://cdn.example/master.m3u8',
    filename: 'meu video',
    outputDir: 'D:/out',
    qualityChoice: '2',
    forceCurl: true,
  });

  assert.equal(await answers.ask('URL do video/playlist:'), 'https://cdn.example/master.m3u8');
  assert.equal(await answers.ask('Escolha (Enter = melhor disponivel):'), '2');
  assert.equal(await answers.ask('Nome do arquivo:'), 'meu video');
  assert.equal(await answers.ask('Pasta de saida (Enter = Downloads):'), 'D:/out');
  assert.equal(await answers.ask('(S)obrescrever, (N)ovo nome, (C)ancelar?'), 'S');
  assert.equal(await answers.ask('Tentar contornar com curl-impersonate?'), 'S');
  assert.equal(await answers.ask('qualquer outra pergunta'), '');
});

test('P9 ensureExt: extensão com e sem ponto, idempotente', async () => {
  const { ensureExt } = await import(`../../src/cli/commands.js?p9-ext=${Date.now()}`);
  assert.equal(ensureExt('audio', 'm4a'), 'audio.m4a');
  assert.equal(ensureExt('audio', '.mp3'), 'audio.mp3');
  assert.equal(ensureExt('audio.m4a', 'm4a'), 'audio.m4a');
  assert.equal(ensureExt('x', ''), 'x');
});

// ---------------------------------------------------------------------------
// Cancelamento (130) — contrato da CLI
// ---------------------------------------------------------------------------

test('P9 compat: cancelar sobrescrita no fluxo interativo → cancelled', async () => {
  fakeYtDlpImpl = async () => YT_DLP_SINGLE;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'cli-130.mp4'), 'existing');

  const answers = {
    async ask(q) {
      if (q.includes('URL do video')) return YOUTUBE_URL;
      if (q.includes('Escolha')) return '';
      if (q.includes('Nome do arquivo')) return 'cli-130';
      if (q.includes('Pasta de saida')) return OUT_DIR;
      if (q.includes('(S)obrescrever')) return 'C';
      return '';
    },
  };
  const { runCliSession } = await import(`../../src/cli-flow.js?p9-130=${Date.now()}`);
  const result = await runCliSession({ argv: [], projectRoot: ROOT, answers, io: NOOP_IO });

  // O cancelamento de sobrescrita retorna code 0 com cancelled:true (compat com
  // o fluxo interativo atual); o exit 130 do contrato é o Ctrl+C (src/input.js).
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'cli-130.mp4')), 'arquivo existente preservado');
});
