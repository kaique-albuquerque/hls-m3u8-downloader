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

const YT_DLP_SINGLE = {
  id: 'abc123',
  title: 'Video de Teste',
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

const YT_DLP_MUX = {
  id: 'abc123',
  title: 'Video Mux',
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

test('parseCliCommand reconhece comandos atuais', async () => {
  const { parseCliCommand } = await import(`../../src/cli/commands.js?parse=${Date.now()}`);
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
  assert.equal(parseCliCommand(['drm']).command, 'interactive');
});

test('parseDownloadFlags mapeia flags principais', async () => {
  const { parseDownloadFlags } = await import(`../../src/cli/commands.js?flags=${Date.now()}`);
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

test('runAnalyzeCommand para youtube retorna sucesso', async () => {
  fakeYtDlpImpl = async () => YT_DLP_SINGLE;
  const { runAnalyzeCommand } = await import(`../../src/cli/commands.js?an=${Date.now()}`);
  const io = makeIo();
  const result = await runAnalyzeCommand({ url: YOUTUBE_URL, projectRoot: ROOT, io, flags: {} });

  assert.equal(result.code, 0);
  assert.equal(result.ok, true);
  assert.equal(result.sourceType, 'youtube');
});

test('runAnalyzeCommand para HLS retorna sucesso', async () => {
  const { runAnalyzeCommand } = await import(`../../src/cli/commands.js?anhls=${Date.now()}`);
  const io = makeIo();
  const result = await runAnalyzeCommand({ url: HLS_URL_MASTER, projectRoot: ROOT, io, flags: {} });

  assert.equal(result.code, 0);
  assert.equal(result.sourceType, 'hls');
});

test('runDownloadCommand baixa mp4 simples', async () => {
  fakeYtDlpImpl = async () => YT_DLP_SINGLE;
  fakeCalls.startDownload = 0;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const { runDownloadCommand } = await import(`../../src/cli/commands.js?dl=${Date.now()}`);
  const io = makeIo();
  const result = await runDownloadCommand({
    url: YOUTUBE_URL,
    projectRoot: ROOT,
    io,
    options: { outputDir: OUT_DIR, filename: 'teste' },
  });

  assert.equal(result.code, 0);
  assert.equal(fakeCalls.startDownload, 1);
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'teste.mp4')));
});

test('runDownloadCommand com mux usa video e audio', async () => {
  fakeYtDlpImpl = async () => YT_DLP_MUX;
  fakeCalls.startDownload = 0;
  fakeCalls.startMuxDownload = 0;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const { runDownloadCommand } = await import(`../../src/cli/commands.js?dlmux=${Date.now()}`);
  const io = makeIo();
  const result = await runDownloadCommand({
    url: YOUTUBE_URL,
    projectRoot: ROOT,
    io,
    options: { outputDir: OUT_DIR, filename: 'mux' },
  });

  assert.equal(result.code, 0);
  assert.equal(fakeCalls.startDownload, 2);
  assert.equal(fakeCalls.startMuxDownload, 1);
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'mux.mp4')));
});
