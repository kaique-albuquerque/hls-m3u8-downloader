import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  extractPlayerJsUrl,
  decipherYouTubeSignature,
  transformYouTubeNParam,
  applyNTransform,
  applySignatureCipher,
  resolveCipherFormats,
} from '../../src/legacy/youtube-signature.js';
import { extractInitialPlayerResponse, parseYouTubePlayerResponse, prepareYouTubeDownload } from '../../src/legacy/youtube.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'youtube');

function fixture(name) {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

const PLAYER_JS = fixture('player.js');

// ---- extractPlayerJsUrl ----
test('legacy youtube extractPlayerJsUrl: jsUrl relativo vira absoluto', () => {
  const html = '<script>var ytcfg={};"jsUrl":"/s/player/abc123/player_ias/vflXYZ/base.js"</script>';
  const url = extractPlayerJsUrl(html, 'https://www.youtube.com');
  assert.equal(url, 'https://www.youtube.com/s/player/abc123/player_ias/vflXYZ/base.js');
});

test('legacy youtube extractPlayerJsUrl: sem referencia retorna vazio', () => {
  assert.equal(extractPlayerJsUrl('<html></html>'), '');
});

// ---- decipherYouTubeSignature ----
test('legacy youtube decipherYouTubeSignature: player fake de caracterizacao', () => {
  assert.equal(decipherYouTubeSignature('abcdef', PLAYER_JS), 'edabc');
});

test('legacy youtube decipherYouTubeSignature: player sem funcao lanca erro', () => {
  assert.throws(() => decipherYouTubeSignature('abcdef', 'var nada=1;'), /Nao foi possivel localizar/);
});

// ---- transformYouTubeNParam / applyNTransform ----
test('legacy youtube transformYouTubeNParam: inverte n no player fake', () => {
  assert.equal(transformYouTubeNParam('abcdef', PLAYER_JS), 'fedcba');
});

test('legacy youtube applyNTransform: substitui n na URL', () => {
  const url = applyNTransform('https://video.example/v.mp4?n=abcdef&x=1', PLAYER_JS);
  assert.ok(url.includes('n=fedcba'), url);
  assert.ok(url.includes('x=1'), 'demais parametros preservados');
});

test('legacy youtube applyNTransform: URL sem n permanece igual', () => {
  assert.equal(applyNTransform('https://video.example/v.mp4?x=1', PLAYER_JS), 'https://video.example/v.mp4?x=1');
});

// ---- applySignatureCipher ----
test('legacy youtube applySignatureCipher: decifra s e aplica em sp', () => {
  const applied = applySignatureCipher('url=https%3A%2F%2Fvideo.example%2Fv.mp4%3Ffoo%3D1&sp=sig&s=abcdef', PLAYER_JS);
  assert.ok(applied.includes('sig=edabc'), applied);
  assert.ok(applied.includes('foo=1'), 'parametros originais preservados');
});

test('legacy youtube applySignatureCipher: cipher invalido lanca erro', () => {
  assert.throws(() => applySignatureCipher('sp=sig', PLAYER_JS), /signatureCipher invalido/);
});

// ---- resolveCipherFormats ----
test('legacy youtube resolveCipherFormats: resolve signatureCipher e mantem url direta', () => {
  const resolved = resolveCipherFormats(
    [
      { itag: 137, signatureCipher: 'url=https%3A%2F%2Fvideo.example%2Fv137&sp=sig&s=abcd', mimeType: 'video/mp4' },
      { itag: 18, url: 'https://video.example/prog.mp4?n=abcdef' },
      { itag: 999, signatureCipher: 'invalido' },
    ],
    PLAYER_JS
  );
  assert.ok(resolved[0].url.includes('sig='), 'signatureCipher resolvido');
  assert.ok(resolved[1].url.includes('n='), 'url direta com n transformado');
  assert.equal(resolved[2].url, undefined, 'cipher invalido nao quebra a lista');
});

// ---- extractInitialPlayerResponse ----
test('legacy youtube extractInitialPlayerResponse: extrai do HTML do fixture', () => {
  const playerResponse = extractInitialPlayerResponse(fixture('player-page.html'));
  assert.equal(playerResponse.videoDetails.videoId, 'abc123');
  assert.ok(playerResponse.streamingData.formats.length === 1);
  assert.ok(playerResponse.streamingData.adaptiveFormats.length === 1);
});

// ---- parseYouTubePlayerResponse ----
test('legacy youtube parseYouTubePlayerResponse: progressivo + adaptativo c/ cipher', () => {
  const html = fixture('player-page.html');
  const playerResponse = extractInitialPlayerResponse(html);
  // o fluxo real (analyzeYouTubeUrl) resolve o cipher antes de parsear
  playerResponse.streamingData.adaptiveFormats = resolveCipherFormats(
    playerResponse.streamingData.adaptiveFormats,
    PLAYER_JS
  );
  const info = parseYouTubePlayerResponse(playerResponse, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(info.title, 'Teste YouTube');
  assert.equal(info.progressiveFormats.length, 1);
  assert.equal(info.adaptiveVideoFormats.length, 1);
  assert.equal(info.variants.length, 2);
  const best = info.variants[0];
  assert.equal(best.sourceKind, 'adaptive');
  assert.equal(best.height, 1080);
});

test('legacy youtube parseYouTubePlayerResponse: cipher nao resolvido nao gera adaptive', () => {
  const html = fixture('player-page.html');
  const info = parseYouTubePlayerResponse(extractInitialPlayerResponse(html), 'https://www.youtube.com/watch?v=abc123');
  // comportamento atual (congelado): formato com apenas signatureCipher (sem url)
  // NAO entra em adaptiveVideoFormats
  assert.equal(info.adaptiveVideoFormats.length, 0);
  assert.equal(info.variants.length, 1);
  assert.equal(info.variants[0].sourceKind, 'progressive');
});

test('legacy youtube parseYouTubePlayerResponse: melhor variante prioriza adaptive de maior altura', () => {
  const playerResponse = {
    videoDetails: { videoId: 'x', title: 'Mixed', lengthSeconds: '12' },
    streamingData: {
      formats: [
        { itag: 18, url: 'https://video.example/360.mp4', mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', qualityLabel: '360p', bitrate: 500000, width: 640, height: 360, audioQuality: 'AUDIO_QUALITY_LOW' },
      ],
      adaptiveFormats: [
        { itag: 137, url: 'https://video.example/1080.mp4', mimeType: 'video/mp4; codecs="avc1.640028"', qualityLabel: '1080p', bitrate: 2500000, width: 1920, height: 1080 },
        { itag: 140, url: 'https://video.example/audio.m4a', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, audioQuality: 'AUDIO_QUALITY_MEDIUM' },
      ],
    },
  };
  const info = parseYouTubePlayerResponse(playerResponse, 'https://www.youtube.com/watch?v=x');
  assert.equal(info.variants[0].sourceKind, 'adaptive');
  assert.equal(info.variants[0].height, 1080);
});

// ---- prepareYouTubeDownload (fetch mockado) ----
test('legacy youtube prepareYouTubeDownload: mux para adaptativo 1080p validado, fallback progressivo', async () => {
  const playerResponse = {
    videoDetails: { videoId: 'x', title: 'Mixed', lengthSeconds: '12' },
    streamingData: {
      formats: [
        { itag: 18, url: 'https://video.example/360.mp4', mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', qualityLabel: '360p', bitrate: 500000, width: 640, height: 360, audioQuality: 'AUDIO_QUALITY_LOW' },
      ],
      adaptiveFormats: [
        { itag: 137, url: 'https://video.example/1080.mp4', mimeType: 'video/mp4; codecs="avc1.640028"', qualityLabel: '1080p', bitrate: 2500000, width: 1920, height: 1080 },
        { itag: 140, url: 'https://video.example/audio.m4a', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, audioQuality: 'AUDIO_QUALITY_MEDIUM' },
      ],
    },
  };
  const analysis = parseYouTubePlayerResponse(playerResponse, 'https://www.youtube.com/watch?v=x');

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    status: String(url).includes('/1080') || String(url).includes('/audio') ? 206 : 403,
    url: String(url),
  });
  try {
    const adaptive = await prepareYouTubeDownload({ analysis, selectedUrl: 'youtube-adaptive:137' });
    assert.equal(adaptive.strategy, 'mux');
    assert.ok(adaptive.videoUrl.includes('/1080'), 'video adaptativo validado');

    const fallback = await prepareYouTubeDownload({ analysis, selectedUrl: 'https://video.example/360.mp4' });
    assert.equal(fallback.strategy, 'mux');
    assert.equal(fallback.videoUrl, 'https://video.example/1080.mp4', 'fallback ainda prioriza melhor qualidade valida');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('legacy youtube prepareYouTubeDownload: nenhuma URL valida lanca YOUTUBE_DOWNLOAD_URL_INVALID', async () => {
  const playerResponse = {
    videoDetails: { videoId: 'x', title: 'T', lengthSeconds: '12' },
    streamingData: {
      formats: [
        { itag: 18, url: 'https://video.example/360.mp4', mimeType: 'video/mp4', qualityLabel: '360p', bitrate: 500000, width: 640, height: 360, audioQuality: 'AUDIO_QUALITY_LOW' },
      ],
      adaptiveFormats: [],
    },
  };
  const analysis = parseYouTubePlayerResponse(playerResponse, 'https://www.youtube.com/watch?v=x');
  assert.equal(analysis.progressiveFormats.length, 1, 'formato com audioQuality e progressivo');

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 403, url: '' });
  try {
    await assert.rejects(
      prepareYouTubeDownload({ analysis, selectedUrl: 'https://video.example/360.mp4' }),
      (err) => err.code === 'YOUTUBE_DOWNLOAD_URL_INVALID'
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
