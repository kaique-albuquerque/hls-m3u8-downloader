// P11.1 — Engine roteia downloads HLS da Media Stream (mdstrm) para o
// curl-impersonate (TLS de navegador) + mux local, em vez de entregar a URL
// remota ao FFmpeg (que o CDN rejeita com 403). Sem rede: transporte curl
// fake + ffmpeg fake; o executor real (createDefaultExecutor) é usado.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mock } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CURL_URL = pathToFileURL(path.join(ROOT, 'src', 'transports', 'curl.js')).href;
const FFMPEG_URL = pathToFileURL(path.join(ROOT, 'src', 'ffmpeg.js')).href;

const CDN_URL =
  'https://us-b4-p-e-jn18.cdn.mdstrm.com/video/h/5e6f83ae335cdd1163e16b5b/6a0375bad35d4ea8b054c20b_6a0375bad35d4ea8b054c21d.mp4/index-v1-a1.m3u8?cP=1970000&pid=abc&sid=def&uid=ghi';

const MEDIA_PLAYLIST = ['#EXTM3U', '#EXTINF:10,', 'seg0.ts', '#EXTINF:10,', 'seg1.ts', ''].join('\n');

const calls = { getText: [], downloadSegments: 0, ffmpegUrls: [] };

// Transporte curl fake: resolve() devolve a instância; getText entrega a
// playlist media; downloadSegments monta uma playlist local.
class FakeTransport {
  constructor() {
    this._client = {};
  }
  static resolve() {
    return new FakeTransport();
  }
  async getText(url) {
    calls.getText.push(url);
    return { text: MEDIA_PLAYLIST, finalUrl: url };
  }
  async downloadSegments({ mediaText, mediaBase, tmpDir, onProgress }) {
    calls.downloadSegments++;
    assert.match(mediaBase, /cdn\.mdstrm\.com/);
    const local = path.join(tmpDir, 'local.m3u8');
    fs.writeFileSync(local, mediaText);
    onProgress?.({ done: 1, total: 2, totalBytes: 100, failed: 0 });
    onProgress?.({ done: 2, total: 2, totalBytes: 200, failed: 0 });
    return { ok: true, localPlaylist: local, extraArgs: [], totalBytes: 200 };
  }
}
mock.module(CURL_URL, {
  namedExports: { CurlImpersonateTransport: FakeTransport },
});

// ffmpeg fake: grava o arquivo de saida e registra a URL recebida.
function fakeStartDownload({ url, output }) {
  calls.ffmpegUrls.push(url);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, 'fake-mp4');
  return { promise: Promise.resolve({ ok: true }), stop: () => {} };
}
mock.module(FFMPEG_URL, {
  namedExports: {
    checkFfmpeg: () => Promise.resolve(true),
    getFfmpegCommand: () => 'ffmpeg',
    startDownload: fakeStartDownload,
    startMuxDownload: () => ({ promise: Promise.resolve({ ok: true }), stop: () => {} }),
  },
});

// Adapter fake com id 'hls' (o engine usa adapter.id como sourceType).
const fakeHlsAdapter = {
  id: 'hls',
  label: 'HLS (.m3u8)',
  async analyze() {
    return { kind: 'media', sourceType: 'hls', title: 'mdstrm test', variants: [], totalDuration: 20 };
  },
  async prepareDownload({ url, selectedUrl }) {
    return { downloadUrl: selectedUrl || url };
  },
};

test('engine: download HLS mdstrm usa curl-impersonate (segmentos) + mux local', async () => {
  const { DownloadEngine, createDefaultExecutor } = await import('../../src/core/index.js');
  const engine = new DownloadEngine({
    executor: createDefaultExecutor(),
    resolveAdapter: async () => fakeHlsAdapter,
    settings: { get: () => path.join(os.tmpdir(), 'sg-mdstrm-out') },
  });

  const outputDir = path.join(os.tmpdir(), 'sg-mdstrm-out');
  fs.rmSync(outputDir, { recursive: true, force: true });

  const job = await engine.run(CDN_URL, {
    destination: outputDir,
    meta: { filename: 'mdstrm-video' },
  });

  assert.equal(job.state, 'completed', `job deveria completar (${job.state})`);
  assert.ok(fs.existsSync(job.meta.output), 'arquivo de saida criado');

  // O transporte curl foi usado (getText + downloadSegments).
  assert.ok(calls.getText.length >= 1, 'getText chamado via curl');
  assert.ok(calls.downloadSegments >= 1, 'downloadSegments chamado via curl');

  // O FFmpeg recebeu a playlist LOCAL (nunca a URL remota do CDN). O tmpDir
  // e limpo depois do mux, entao validamos o formato do caminho.
  assert.equal(calls.ffmpegUrls.length, 1, 'startDownload chamado 1x (mux local)');
  assert.ok(!/cdn\.mdstrm\.com/.test(calls.ffmpegUrls[0]), 'FFmpeg nao recebe URL remota do CDN');
  assert.ok(!/^https?:/.test(calls.ffmpegUrls[0]), 'FFmpeg recebe caminho local, nao URL');
  assert.ok(calls.ffmpegUrls[0].endsWith('.m3u8'), 'FFmpeg recebe a playlist local (.m3u8)');
});
