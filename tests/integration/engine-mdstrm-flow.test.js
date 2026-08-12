// P11.1 — Teste de integração do fluxo completo mdstrm:
//   análise HLS (renderer, tokens T1) -> escolha de variante -> fila ->
//   engine (re-análise com tokens frescos T2) -> transporte correto.
//
// Requisito central: quando o transporte específico (curl-impersonate) está
// DISPONÍVEL, o teste FALHA se o engine cair no FFmpeg direto com a URL
// remota. E, mesmo sem o transporte, o engine NUNCA usa a variante com tokens
// velhos (T1) — sempre re-resolve a variante fresca (T2) por pathname,
// exatamente como o CLI.
//
// Sem rede externa: servidor HTTP local simula o player mdstrm (master com
// tokens que mudam a cada request, como o refresh do player).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mock } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MDSTRM_URL = pathToFileURL(path.join(ROOT, 'src', 'mdstrm.js')).href;
const CURL_URL = pathToFileURL(path.join(ROOT, 'src', 'transports', 'curl.js')).href;
const FFMPEG_URL = pathToFileURL(path.join(ROOT, 'src', 'ffmpeg.js')).href;

// isMdstrmUrl sempre true: as URLs locais do teste entram no roteamento
// mdstrm do engine (o CDN real nunca é alcançado).
mock.module(MDSTRM_URL, {
  namedExports: { isMdstrmUrl: () => true },
});

let transportAvailable = true;
const calls = { getText: [], downloadSegments: 0, ffmpegUrls: [], logs: [] };

// Transporte curl fake: resolve() devolve a instância quando "instalado"
// (transportAvailable) — igual ao findCurlImpersonate real.
class FakeTransport {
  constructor() {
    this._client = {};
  }
  static resolve() {
    return transportAvailable ? new FakeTransport() : null;
  }
  async getText(url) {
    calls.getText.push(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { text: await res.text(), finalUrl: url };
  }
  async downloadSegments({ mediaText, mediaBase: _mediaBase, tmpDir, onProgress }) {
    calls.downloadSegments++;
    const local = path.join(tmpDir, 'local.m3u8');
    fs.writeFileSync(local, mediaText);
    onProgress?.({ done: 1, total: 1, totalBytes: 10, failed: 0 });
    return { ok: true, localPlaylist: local, extraArgs: [], totalBytes: 10 };
  }
}
mock.module(CURL_URL, {
  namedExports: { CurlImpersonateTransport: FakeTransport },
});

// ffmpeg fake: registra a URL recebida. Se receber URL REMOTA (http/https)
// ENQUANTO o transporte específico está disponível, rejeita — o teste falha,
// provando que o engine caiu no FFmpeg direto (proibido nesse cenário).
// Quando o transporte está AUSENTE, FFmpeg direto é o fluxo legado/CLI.
function fakeStartDownload({ url, output }) {
  calls.ffmpegUrls.push(url);
  if (/^https?:/.test(url) && transportAvailable) {
    return {
      promise: Promise.reject(new Error(`FFMPEG_DIRETO: engine usou FFmpeg com URL remota: ${url}`)),
      stop: () => {},
    };
  }
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

// Servidor HTTP local: master com tokens frescos a cada request.
function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/video/test-video.m3u8') {
      tokenCounter += 1;
      const port = server.address().port;
      const body = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=1970000,RESOLUTION=1920x1080',
        `http://127.0.0.1:${port}/video/h/test-video/index-v1-a1.m3u8?tok=${tokenCounter}&access_token=secret-${tokenCounter}`,
        '',
      ].join('\n');
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end(body);
      return;
    }
    if (url.pathname === '/video/h/test-video/index-v1-a1.m3u8') {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end(['#EXTM3U', '#EXTINF:10,', '/seg0.ts', '#EXTINF:10,', '/seg1.ts', ''].join('\n'));
      return;
    }
    res.writeHead(404);
    res.end('nf');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let tokenCounter = 0;

function waitForEvent(engine, name, jobId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout aguardando '${name}' do job ${jobId}`)), 10000);
    engine.on(name, function handler(payload) {
      if (payload.jobId !== jobId) return;
      clearTimeout(timer);
      engine.off(name, handler);
      resolve(payload);
    });
  });
}

async function simulateRendererAnalysis(playerUrl) {
  // Simula a análise do renderer: tokens T1 (que ficam "velhos" quando o
  // engine roda, pois ele re-analisa e obtém T2).
  const res = await fetch(playerUrl);
  const text = await res.text();
  const variant = text.split('\n').find((l) => l.includes('.m3u8'));
  assert.ok(variant, 'master local deve ter variante');
  return variant;
}

async function createHarness() {
  tokenCounter = 0; // reinicia os tokens T1 por teste
  const server = await startServer();
  const port = server.address().port;
  const playerUrl = `http://127.0.0.1:${port}/video/test-video.m3u8`;
  const outputDir = path.join(os.tmpdir(), `sg-mdstrm-flow-${process.pid}`);
  fs.rmSync(outputDir, { recursive: true, force: true });

  const { DownloadEngine, createDefaultExecutor, createDownloadQueue } = await import('../../src/core/index.js');
  const engine = new DownloadEngine({
    executor: createDefaultExecutor(),
    settings: { get: () => outputDir },
  });
  const queue = createDownloadQueue({ engine, maxConcurrent: 1, autoStart: true });

  engine.on('log', (payload) => calls.logs.push(payload.message));
  engine.on('error', (payload) => calls.logs.push(`[error] ${payload.message}`));

  return { server, playerUrl, outputDir, engine, queue };
}

test('fluxo mdstrm: transporte disponivel -> curl (segmentos) + mux local, nunca FFmpeg direto', async () => {
  transportAvailable = true;
  calls.getText.length = 0;
  calls.downloadSegments = 0;
  calls.ffmpegUrls.length = 0;
  calls.logs.length = 0;

  const { server, playerUrl, queue, engine } = await createHarness();
  try {
    const staleVariant = await simulateRendererAnalysis(playerUrl);
    assert.match(staleVariant, /tok=1/, 'analise do renderer gera tokens T1');

    const job = queue.enqueue(playerUrl, {
      title: 'mdstrm-flow',
      meta: { selectedUrl: staleVariant, headers: {}, destination: path.join(os.tmpdir(), `sg-mdstrm-flow-${process.pid}`) },
    });
    const completed = await waitForEvent(engine, 'complete', job.id);

    assert.equal(completed.jobId, job.id);
    assert.ok(fs.existsSync(completed.output || ''), 'arquivo de saida criado');

    // O transporte específico (curl) foi usado.
    assert.ok(calls.getText.length >= 1, 'getText via curl');
    assert.equal(calls.getText[0], playerUrl, 'curl deve começar pela URL do player, nao pela variante CDN');
    assert.ok(calls.downloadSegments >= 1, 'downloadSegments via curl');

    // FFmpeg recebeu a playlist LOCAL (nunca a URL remota). Se o engine
    // tivesse caído no FFmpeg direto, a promise rejeitaria e o job falharia.
    assert.equal(calls.ffmpegUrls.length, 1, 'startDownload 1x (mux local)');
    assert.ok(!/^https?:/.test(calls.ffmpegUrls[0]), 'FFmpeg NUNCA recebe URL remota');
    assert.ok(calls.ffmpegUrls[0].endsWith('.m3u8'), 'FFmpeg recebe playlist local');

    // Diagnóstico sanitizado: transporte disponível + sem tokens no log.
    assert.ok(
      calls.logs.some((l) => l.includes('transporte curl-impersonate disponivel=true')),
      'log deve reportar transporte disponivel'
    );
    for (const line of calls.logs) {
      assert.ok(!line.includes('secret-'), `log nao pode conter tokens completos: ${line}`);
    }
  } finally {
    server.close();
  }
});

test('fluxo mdstrm: transporte AUSENTE -> FFmpeg com a variante FRESCA (T2), nunca a velha (T1)', async () => {
  transportAvailable = false;
  calls.getText.length = 0;
  calls.downloadSegments = 0;
  calls.ffmpegUrls.length = 0;
  calls.logs.length = 0;

  const { server, playerUrl, queue, engine } = await createHarness();
  try {
    const staleVariant = await simulateRendererAnalysis(playerUrl);
    assert.match(staleVariant, /tok=1/, 'analise do renderer gera tokens T1');

    const job = queue.enqueue(playerUrl, {
      title: 'mdstrm-flow',
      meta: { selectedUrl: staleVariant, headers: {}, destination: path.join(os.tmpdir(), `sg-mdstrm-flow-${process.pid}`) },
    });
    const completed = await waitForEvent(engine, 'complete', job.id);

    assert.equal(completed.jobId, job.id);
    assert.ok(fs.existsSync(completed.output || ''), 'arquivo de saida criado');

    // Sem curl: o engine usa o FFmpeg direto, mas com a variante FRESCA da
    // re-análise (T2) — nunca a variante velha escolhida na UI (T1).
    assert.equal(calls.ffmpegUrls.length, 1, 'startDownload 1x');
    const used = calls.ffmpegUrls[0];
    assert.match(used, /tok=2/, `FFmpeg usa variante fresca T2 (recebeu: ${used})`);
    assert.doesNotMatch(used, /tok=1/, `FFmpeg nunca usa variante velha T1 (recebeu: ${used})`);

    // Diagnóstico sanitizado: curl ausente + fallback explícito.
    assert.ok(
      calls.logs.some((l) => l.includes('curl-impersonate AUSENTE')),
      'log deve reportar curl ausente e o motivo do fallback'
    );
    assert.ok(
      calls.logs.some((l) => l.includes('variante re-resolvida com tokens frescos')),
      'log deve reportar a re-resolução da variante'
    );
    for (const line of calls.logs) {
      assert.ok(!line.includes('secret-'), `log nao pode conter tokens completos: ${line}`);
    }
  } finally {
    server.close();
  }
});
