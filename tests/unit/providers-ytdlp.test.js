// Unit: provider ytdlp (P3) — detecção + normalização MediaInfo/Format.
//
// Sem rede externa: o módulo youtube-dl-exec é mockado com mock.module
// (--experimental-test-module-mocks) e devolve o FIXTURE REAL salvo em
// tests/fixtures/ytdlp/youtube-info.json, garantindo que o shape cru do
// yt-dlp não vaza para consumidores do provider (Format normalizado).

import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function loadProvider() {
  return import(`../../src/providers/ytdlp/index.js?p3-ytdlp=${Date.now()}`);
}

// ---- detect ----
test('ytdlp provider: detect reconhece youtube e social', async () => {
  const { ytdlpProvider } = await loadProvider();
  assert.equal(ytdlpProvider.detect('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(ytdlpProvider.detect('https://www.youtube.com/shorts/xyz'), true);
  assert.equal(ytdlpProvider.detect('https://www.instagram.com/reel/xyz/'), true);
  assert.equal(ytdlpProvider.detect('https://www.tiktok.com/@u/video/1'), true);
  assert.equal(ytdlpProvider.detect('https://cdn.example.com/video.mp4'), false);
  assert.equal(ytdlpProvider.detect('https://cdn.example.com/index.m3u8'), false);
});

test('ytdlp provider: detect com forceYouTube', async () => {
  const { ytdlpProvider } = await loadProvider();
  assert.equal(ytdlpProvider.detect('https://www.youtube.com/watch?v=abc', { forceYouTube: true }), true);
  assert.equal(ytdlpProvider.detect('https://www.instagram.com/reel/xyz/', { forceYouTube: true }), false);
});

// ---- analyze: normalização sem vazar shape cru ----
test('ytdlp provider: analyze normaliza MediaInfo sem vazar formato cru', async () => {
  fakeYtDlpImpl = async () => FIXTURE;
  const { ytdlpProvider } = await loadProvider();

  const info = await ytdlpProvider.analyze({ url: 'https://www.youtube.com/watch?v=abc123' });

  assert.equal(info.kind, 'ytdlp');
  assert.equal(info.sourceType, 'ytdlp');
  assert.equal(info.provider, 'ytdlp');
  assert.equal(info.title, 'Vídeo de Teste StreamGrab');
  assert.equal(info.videoId, 'abc123');
  assert.equal(info.durationSeconds, 125);

  // 1 progressivo (itag 18) + 1 vídeo adaptativo (itag 137) -> 2 variantes.
  assert.equal(info.variants.length, 2);
  assert.ok(
    info.variants.some((v) => v.uri.startsWith('ytdlp-format:')),
    'variantes adaptativos usam a URI mágica, nunca a URL crua do formato'
  );

  const formats = ytdlpProvider.getFormats(info);
  assert.equal(formats.length, 3); // 18 progressivo + 137 vídeo + 140 áudio
  const byId = Object.fromEntries(formats.map((f) => [f.formatId, f]));

  // Format normalizado: formatId sempre string e campos com defaults neutros.
  for (const f of formats) {
    assert.equal(typeof f.formatId, 'string');
    assert.equal(typeof f.hasVideo, 'boolean');
    assert.equal(typeof f.hasAudio, 'boolean');
  }
  assert.equal(byId['18'].hasVideo, true);
  assert.equal(byId['18'].hasAudio, true);
  assert.equal(byId['137'].hasVideo, true);
  assert.equal(byId['137'].hasAudio, false);
  assert.equal(byId['140'].hasVideo, false);
  assert.equal(byId['140'].hasAudio, true);

  // Formato cru do yt-dlp (format_id numérico cru) não aparece no MediaInfo.
  assert.equal('formats' in info, true);
  assert.equal(typeof info.formats[0].formatId, 'string');
  assert.ok(!Object.keys(info.formats[0]).includes('format_id'), 'formato cru nao vaza');
});

test('ytdlp provider: analyze sem formatos utilizaveis propaga erro', async () => {
  fakeYtDlpImpl = async () => ({ id: 'x', title: 'X', formats: [] });
  const { ytdlpProvider } = await loadProvider();
  await assert.rejects(
    ytdlpProvider.analyze({ url: 'https://www.youtube.com/watch?v=x' }),
    (err) => err.code === 'YTDLP_FORMAT_UNAVAILABLE'
  );
});

test('ytdlp provider: prepareDownload delega ao mecanismo atual', async () => {
  fakeYtDlpImpl = async () => FIXTURE;
  const { ytdlpProvider } = await loadProvider();
  const info = await ytdlpProvider.analyze({ url: 'https://www.youtube.com/watch?v=abc123' });
  const adaptive = info.variants.find((v) => v.uri.startsWith('ytdlp-format:'));
  const plan = await ytdlpProvider.prepareDownload({
    analysis: info,
    selectedUrl: adaptive.uri,
  });
  assert.equal(plan.strategy, 'mux');
  assert.ok(plan.videoUrl);
  assert.ok(plan.audioUrl);
});
