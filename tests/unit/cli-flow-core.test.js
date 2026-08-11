// P2.6 — cli-flow consome StreamGrabCore (strangler) no fluxo YouTube/redes sociais.
//
// Sem rede: mock de youtube-dl-exec (yt-dlp) e mock de src/ffmpeg.js
// (checkFfmpeg/startDownload/startMuxDownload). O StreamGrabCore é REAL — o
// teste prova que runCliSession -> core.analyze -> executor real -> adapter
// youtube real -> yt-dlp (mock) -> MediaInfo normalizado -> chooseVariant ->
// prepareDownload -> runDownloadFlow/runMuxedDownloadFlow termina com exit
// code 0 e arquivo salvo, SEM mudar o contrato observável da CLI (prompts,
// flags, exit codes e MODE_LABELS idênticos).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mock } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(os.tmpdir(), 'vd-cli-core-test');
const FFMPEG_URL = pathToFileURL(path.join(ROOT, 'src', 'ffmpeg.js')).href;

let fakeYtDlpImpl = null;
mock.module('youtube-dl-exec', {
  namedExports: {
    youtubeDl: async (...args) => fakeYtDlpImpl(...args),
  },
});

const fakeCalls = { analyzeArgs: null, startDownload: 0, startMuxDownload: 0 };
// NOTA: startDownload/startMuxDownload sao consumidos sincronamente pela CLI
// (`const { promise, stop } = startDownload(...)`), entao o mock NAO pode ser
// async (async devolveria uma Promise em vez do objeto { promise, stop }).
mock.module(FFMPEG_URL, {
  namedExports: {
    checkFfmpeg: () => Promise.resolve(true),
    getFfmpegCommand: () => 'ffmpeg',
    startDownload: ({ output }) => {
      fakeCalls.startDownload++;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'fake-mp4');
      return { promise: Promise.resolve({ ok: true }), stop: () => {} };
    },
    startMuxDownload: ({ output }) => {
      fakeCalls.startMuxDownload++;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'fake-muxed-mp4');
      return { promise: Promise.resolve({ ok: true }), stop: () => {} };
    },
  },
});

/** JSON do yt-dlp minimo: 1 formato progressivo (itag 18). */
const YT_DLP_SINGLE = {
  id: 'abc123',
  title: 'Video de Teste P2.6',
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
  title: 'Video Mux P2.6',
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

function makeAnswers() {
  return {
    async ask(question) {
      if (question.includes('URL do video/playlist')) return YOUTUBE_URL;
      if (question.includes('Escolha (Enter = melhor disponivel)')) return '';
      if (question.includes('Nome do arquivo')) return 'cli-core-test';
      if (question.includes('Pasta de saida')) return OUT_DIR;
      if (question.includes('(S)obrescrever, (N)ovo nome, (C)ancelar?')) return 'S';
      return '';
    },
  };
}

const NOOP_IO = { log: () => {}, error: () => {}, onState: () => {} };

test('cli-flow P2.6: fluxo youtube passa pelo StreamGrabCore (single, exit 0)', async () => {
  fakeYtDlpImpl = async () => YT_DLP_SINGLE;
  fakeCalls.analyzeArgs = null;
  fakeCalls.startDownload = 0;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  const { runCliSession } = await import(`../../src/cli-flow.js?p26-single=${Date.now()}`);
  const result = await runCliSession({ argv: [], projectRoot: ROOT, answers: makeAnswers(), io: NOOP_IO });

  assert.equal(result.code, 0, `exit code 0 (foi ${result.code})`);
  assert.equal(result.ok, true);
  assert.equal(result.output, path.join(OUT_DIR, 'cli-core-test.mp4'));
  assert.equal(result.targetUrl, 'https://cdn.example/prog.mp4');
  assert.equal(result.mode, 'copia direta (-c copy)');
  assert.equal(fakeCalls.startDownload, 1, 'download unico (progressivo)');
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'cli-core-test.mp4')), 'arquivo de saida gravado');
});

test('cli-flow P2.6: fluxo youtube adaptativo usa mux (video+audio) com exit 0', async () => {
  fakeYtDlpImpl = async () => YT_DLP_MUX;
  fakeCalls.startDownload = 0;
  fakeCalls.startMuxDownload = 0;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  const { runCliSession } = await import(`../../src/cli-flow.js?p26-mux=${Date.now()}`);
  const result = await runCliSession({ argv: [], projectRoot: ROOT, answers: makeAnswers(), io: NOOP_IO });

  assert.equal(result.code, 0, `exit code 0 (foi ${result.code})`);
  assert.equal(result.ok, true);
  assert.equal(result.output, path.join(OUT_DIR, 'cli-core-test.mp4'));
  assert.equal(fakeCalls.startDownload, 2, 'video + audio baixados separadamente');
  assert.equal(fakeCalls.startMuxDownload, 1, 'mux executado');
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'cli-core-test.mp4')), 'arquivo muxado gravado');
});

test('cli-flow P2.6: flag --youtube preserva a URL original na analise via core', async () => {
  fakeYtDlpImpl = async (...args) => {
    fakeCalls.analyzeArgs = args;
    return YT_DLP_SINGLE;
  };
  fakeCalls.analyzeArgs = null;
  fakeCalls.startDownload = 0;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  const { runCliSession } = await import(`../../src/cli-flow.js?p26-forceyt=${Date.now()}`);
  const result = await runCliSession({ argv: ['--youtube'], projectRoot: ROOT, answers: makeAnswers(), io: NOOP_IO });

  assert.equal(result.code, 0, `exit code 0 (foi ${result.code})`);
  assert.equal(fakeCalls.analyzeArgs?.[0], YOUTUBE_URL, 'yt-dlp recebe a URL original (nao o placeholder)');
  assert.equal(result.output, path.join(OUT_DIR, 'cli-core-test.mp4'));
});
