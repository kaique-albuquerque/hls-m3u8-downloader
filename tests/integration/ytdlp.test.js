// Integration: yt-dlp (analyzeYtDlpUrl + prepareYtDlpDownload).
//
// Sem rede externa: o modulo youtube-dl-exec e mockado com mock.module
// (--experimental-test-module-mocks) e devolve o FIXTURE REAL salvo em
// tests/fixtures/ytdlp/youtube-info.json, congelando o shape do dump do
// yt-dlp e o pipeline analise -> preparacao do download (fallback de
// transport: mux para adaptativo, single para progressivo).
//
// Rede seria necessaria apenas se o mock for removido.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mock } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ytdlp', 'youtube-info.json'), 'utf8')
);

let fakeYtDlpImpl = null;
mock.module('youtube-dl-exec', {
  namedExports: {
    youtubeDl: async (...args) => fakeYtDlpImpl(...args),
  },
});

test('ytdlp: fixture real de youtube-info.json tem o shape esperado', () => {
  assert.equal(FIXTURE.id, 'abc123');
  assert.equal(FIXTURE.duration, 125);
  assert.ok(Array.isArray(FIXTURE.formats));
  assert.ok(FIXTURE.formats.length >= 4, 'fixture deve ter progressivo + 2 videos adaptativos + audio');
  const byId = Object.fromEntries(FIXTURE.formats.map((f) => [String(f.format_id), f]));
  assert.equal(byId['18'].vcodec !== 'none' && byId['18'].acodec !== 'none', true, 'itag 18 progressivo');
  assert.equal(byId['137'].acodec, 'none', 'itag 137 video adaptativo');
  assert.equal(byId['140'].vcodec, 'none', 'itag 140 audio adaptativo');
});

test('ytdlp: analise do fixture real -> mux para video adaptativo 1080p', async () => {
  fakeYtDlpImpl = async () => FIXTURE;
  const mod = await import(`../../src/adapters/ytdlp.js?it-mock=${Date.now()}`);

  const analysis = await mod.analyzeYtDlpUrl('https://www.youtube.com/watch?v=abc123');
  assert.equal(analysis.kind, 'ytdlp');
  assert.equal(analysis.title, 'Vídeo de Teste StreamGrab');
  assert.equal(analysis.videoId, 'abc123');
  assert.equal(analysis.durationSeconds, 125);

  // progressivo: itag 18
  assert.equal(analysis.progressiveFormats.length, 1);
  assert.equal(analysis.progressiveFormats[0].formatId, '18');
  assert.equal(analysis.progressiveFormats[0].bitrate, 500000, 'tbr 500 kbps -> bps');

  // video adaptativo: itag 137 (247 descartado por url vazia)
  assert.equal(analysis.adaptiveVideoFormats.length, 1);
  assert.equal(analysis.adaptiveVideoFormats[0].formatId, '137');
  assert.equal(analysis.adaptiveVideoFormats[0].height, 1080);
  assert.equal(analysis.adaptiveVideoFormats[0].bitrate, 2500000, 'sem duration no formato, usa tbr 2500 kbps');

  // audio adaptativo: itag 140
  assert.equal(analysis.adaptiveAudioFormats.length, 1);
  assert.equal(analysis.adaptiveAudioFormats[0].formatId, '140');

  // variantes: adaptive 1080p primeiro, depois progressivo 360p
  assert.equal(analysis.variants.length, 2);
  assert.equal(analysis.variants[0].sourceKind, 'adaptive');
  assert.equal(analysis.variants[0].height, 1080);
  assert.equal(analysis.variants[0].uri, 'ytdlp-format:137', 'URI adaptativa usa o prefixo ytdlp-format:');
  assert.equal(analysis.variants[1].sourceKind, 'progressive');
  assert.equal(analysis.variants[1].uri, 'https://example.com/prog.mp4');

  // pipeline de preparacao: adaptativo -> mux
  const prepared = await mod.prepareYtDlpDownload({
    analysis,
    selectedUrl: 'ytdlp-format:137',
  });
  assert.equal(prepared.strategy, 'mux');
  assert.equal(prepared.videoUrl, 'https://example.com/v137.mp4');
  assert.equal(prepared.audioUrl, 'https://example.com/a140.m4a');
  assert.equal(prepared.videoBytes, 4567890);
  assert.equal(prepared.durationMs, 125000);

  // pipeline de preparacao: progressivo -> single
  const single = await mod.prepareYtDlpDownload({
    analysis,
    selectedUrl: 'https://example.com/prog.mp4',
  });
  assert.equal(single.strategy, 'single');
  assert.equal(single.downloadUrl, 'https://example.com/prog.mp4');
  assert.equal(single.totalBytes, 1234567);
});

test('ytdlp: erro restrito -> YTDLP_ANALYZE_FAILED com needsAuth e dica de cookies', async () => {
  fakeYtDlpImpl = async () => {
    const err = new Error('Sign in to confirm your age');
    err.stderr = 'ERROR: Sign in to confirm your age. This video is only available to signed-in users.';
    throw err;
  };
  const mod = await import(`../../src/adapters/ytdlp.js?it-auth=${Date.now()}`);

  await assert.rejects(
    () => mod.analyzeYtDlpUrl('https://www.youtube.com/watch?v=abc123'),
    (err) => {
      assert.equal(err.code, 'YTDLP_ANALYZE_FAILED');
      assert.equal(err.needsAuth, true);
      assert.match(err.message, /cookies/);
      return true;
    }
  );
});

test('ytdlp: sem formatos utilizaveis -> YTDLP_FORMAT_UNAVAILABLE', async () => {
  fakeYtDlpImpl = async () => ({
    title: 'x',
    formats: [
      { format_id: '1', vcodec: 'none', acodec: 'none', url: '' },
      { format_id: '2', vcodec: 'avc1', acodec: 'none', url: '' }, // url vazia -> descartado
    ],
  });
  const mod = await import(`../../src/adapters/ytdlp.js?it-vazio=${Date.now()}`);

  await assert.rejects(
    () => mod.analyzeYtDlpUrl('https://www.youtube.com/watch?v=abc123'),
    (err) => {
      assert.equal(err.code, 'YTDLP_FORMAT_UNAVAILABLE');
      return true;
    }
  );
});
