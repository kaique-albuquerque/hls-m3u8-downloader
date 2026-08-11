import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  YTDLP_FORMAT_UNAVAILABLE,
  ADAPTIVE_URI_PREFIX,
  isLoginRequiredError,
  prepareYtDlpDownload,
} from '../../src/adapters/ytdlp.js';

const FIXTURE = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ytdlp', 'youtube-info.json'), 'utf8')
);

/**
 * Implementacao de referencia de mapYtDlpFormat (nao exportado) para montar a
 * analise consumida por prepareYtDlpDownload — congela o shape esperado.
 */
function computeBitrate(format) {
  const duration = Number(format.duration) || 0;
  const size = Number(format.filesize || format.filesize_approx) || 0;
  if (duration > 0 && size > 0) return Math.round((size * 8) / duration);
  const raw = Number(format.tbr || format.vbr || format.abr) || 0;
  if (!raw) return 0;
  return raw < 1_000_000 ? Math.round(raw * 1000) : Math.round(raw);
}

function mapYtDlpFormat(format) {
  const codecs = [format.vcodec, format.acodec].filter(Boolean).join(', ');
  return {
    itag: Number(format.format_id) || 0,
    formatId: String(format.format_id || ''),
    url: format.url || '',
    mimeType: format.ext ? `video/${format.ext}` : '',
    container: format.ext || '',
    codecs,
    qualityLabel: format.format_note || (format.height ? `${format.height}p` : ''),
    bitrate: computeBitrate(format),
    width: Number(format.width) || 0,
    height: Number(format.height) || 0,
    fps: Number(format.fps) || 0,
    audioQuality: format.acodec && format.acodec !== 'none' ? 'AUDIO_QUALITY_MEDIUM' : '',
    hasVideo: Boolean(format.vcodec && format.vcodec !== 'none'),
    hasAudio: Boolean(format.acodec && format.acodec !== 'none'),
    contentLength: Number(format.filesize || format.filesize_approx) || 0,
    signatureCipher: '',
  };
}

function buildAnalysis(fixture) {
  const formats = fixture.formats.filter((f) => f.url).map(mapYtDlpFormat);
  return {
    kind: 'ytdlp',
    pageUrl: fixture.webpage_url,
    title: fixture.title,
    videoId: fixture.id,
    durationSeconds: fixture.duration,
    progressiveFormats: formats.filter((f) => f.hasVideo && f.hasAudio),
    adaptiveFormats: formats.filter((f) => !(f.hasVideo && f.hasAudio)),
    adaptiveVideoFormats: formats.filter((f) => f.hasVideo && !f.hasAudio),
    adaptiveAudioFormats: formats.filter((f) => !f.hasVideo && f.hasAudio),
    variants: [],
  };
}

// ---- constantes ----
test('ytdlp: constantes congeladas', () => {
  assert.equal(YTDLP_FORMAT_UNAVAILABLE, 'YTDLP_FORMAT_UNAVAILABLE');
  assert.equal(ADAPTIVE_URI_PREFIX, 'ytdlp-format:');
});

// ---- isLoginRequiredError ----
test('ytdlp isLoginRequiredError: detecta dicas de conteudo restrito', () => {
  assert.equal(isLoginRequiredError('ERROR: Sign in to confirm you are not a bot'), true);
  assert.equal(isLoginRequiredError('This video is private'), true);
  assert.equal(isLoginRequiredError('ERROR: 403 Forbidden'), true);
  assert.equal(isLoginRequiredError('This is a members only video'), true);
  assert.equal(isLoginRequiredError('Requested format is not available'), true);
  assert.equal(isLoginRequiredError('Video unavailable'), false);
  assert.equal(isLoginRequiredError(''), false);
  assert.equal(isLoginRequiredError(null), false);
});

// ---- prepareYtDlpDownload ----
const analysis = buildAnalysis(FIXTURE);
const adaptiveVideo = analysis.adaptiveVideoFormats.find((f) => f.formatId === '137');
const audio = analysis.adaptiveAudioFormats.find((f) => f.formatId === '140');
const progressive = analysis.progressiveFormats.find((f) => f.formatId === '18');

test('ytdlp prepareYtDlpDownload: URI adaptativa com audio -> mux', async () => {
  const prepared = await prepareYtDlpDownload({
    analysis,
    selectedUrl: `${ADAPTIVE_URI_PREFIX}137`,
  });
  assert.equal(prepared.strategy, 'mux');
  assert.equal(prepared.videoUrl, adaptiveVideo.url);
  assert.equal(prepared.audioUrl, audio.url);
  assert.equal(prepared.chosenFormat.formatId, '137');
  assert.equal(prepared.chosenFormat.height, 1080);
  assert.equal(prepared.durationMs, 125000);
  assert.ok(prepared.totalBytes > 0, 'totalBytes soma video+audio');
});

test('ytdlp prepareYtDlpDownload: formato adaptativo inexistente lanca YTDLP_FORMAT_UNAVAILABLE', async () => {
  await assert.rejects(
    prepareYtDlpDownload({ analysis, selectedUrl: `${ADAPTIVE_URI_PREFIX}999` }),
    (err) => {
      assert.equal(err.code, YTDLP_FORMAT_UNAVAILABLE);
      return true;
    }
  );
});

test('ytdlp prepareYtDlpDownload: adaptativo sem audio disponivel -> single', async () => {
  const analysisSemAudio = buildAnalysis({
    ...FIXTURE,
    formats: FIXTURE.formats.filter((f) => f.format_id !== '140'),
  });
  const prepared = await prepareYtDlpDownload({
    analysis: analysisSemAudio,
    selectedUrl: `${ADAPTIVE_URI_PREFIX}137`,
  });
  assert.equal(prepared.strategy, 'single');
  assert.equal(prepared.downloadUrl, adaptiveVideo.url);
});

test('ytdlp prepareYtDlpDownload: URL progressiva -> single', async () => {
  const prepared = await prepareYtDlpDownload({ analysis, selectedUrl: progressive.url });
  assert.equal(prepared.strategy, 'single');
  assert.equal(prepared.downloadUrl, progressive.url);
  assert.equal(prepared.chosenFormat.sourceKind, 'progressive');
  assert.equal(prepared.chosenFormat.formatId, '18');
});

test('ytdlp prepareYtDlpDownload: URL arbitraria passa direto', async () => {
  const prepared = await prepareYtDlpDownload({ analysis, selectedUrl: 'https://exemplo.com/direto.mp4' });
  assert.equal(prepared.strategy, 'single');
  assert.equal(prepared.downloadUrl, 'https://exemplo.com/direto.mp4');
});

test('ytdlp prepareYtDlpDownload: sem selecao lanca YTDLP_FORMAT_UNAVAILABLE', async () => {
  await assert.rejects(
    prepareYtDlpDownload({ analysis }),
    (err) => {
      assert.equal(err.code, YTDLP_FORMAT_UNAVAILABLE);
      return true;
    }
  );
});

test('ytdlp: fixture congela shape dos formatos (caracterizacao)', () => {
  assert.equal(analysis.progressiveFormats.length, 1);
  assert.equal(analysis.adaptiveVideoFormats.length, 1);
  assert.equal(analysis.adaptiveAudioFormats.length, 1);
  assert.equal(analysis.adaptiveFormats.length, 2);
  assert.equal(progressive.height, 360);
  assert.equal(adaptiveVideo.height, 1080);
  // formato nao tem duration: bitrate vem do tbr (2500 kbps -> 2500000 bps)
  assert.equal(adaptiveVideo.bitrate, 2500000);
});

// ---- analyzeYtDlpUrl (youtube-dl-exec mockado via mock.module; sem rede) ----
// mock.module so pode ser registrado UMA vez por processo; o impl e trocado
// atraves de uma variavel compartilhada.
let fakeYtDlpImpl = null;
mock.module('youtube-dl-exec', {
  namedExports: {
    youtubeDl: async (...args) => fakeYtDlpImpl(...args),
  },
});

test('ytdlp analyzeYtDlpUrl: com youtube-dl mockado, extrai formatos do fixture', async () => {
  fakeYtDlpImpl = async () => FIXTURE;
  const mod = await import(`../../src/adapters/ytdlp.js?mock-ok=${Date.now()}`);

  const analysis = await mod.analyzeYtDlpUrl('https://www.youtube.com/watch?v=abc123');

  assert.equal(analysis.kind, 'ytdlp');
  assert.equal(analysis.title, 'Vídeo de Teste StreamGrab');
  assert.equal(analysis.videoId, 'abc123');
  assert.equal(analysis.durationSeconds, 125);

  // progressivos: apenas format 18 (video+audio+url)
  assert.equal(analysis.progressiveFormats.length, 1);
  assert.equal(analysis.progressiveFormats[0].itag, 18);
  assert.equal(analysis.progressiveFormats[0].hasVideo, true);
  assert.equal(analysis.progressiveFormats[0].hasAudio, true);

  // adaptativos de video: apenas 137 (247 sem url descartado)
  assert.equal(analysis.adaptiveVideoFormats.length, 1);
  assert.equal(analysis.adaptiveVideoFormats[0].itag, 137);
  assert.equal(analysis.adaptiveVideoFormats[0].height, 1080);
  assert.equal(analysis.adaptiveVideoFormats[0].hasAudio, false);

  // adaptativos de audio: apenas 140
  assert.equal(analysis.adaptiveAudioFormats.length, 1);
  assert.equal(analysis.adaptiveAudioFormats[0].itag, 140);

  // bitrate: formato nao tem duration, entao vem do tbr (2500 kbps -> bps)
  assert.equal(analysis.adaptiveVideoFormats[0].bitrate, 2500000);

  // variants: adaptativo primeiro, depois progressivo
  assert.equal(analysis.variants.length, 2);
  assert.equal(analysis.variants[0].sourceKind, 'adaptive');
  assert.equal(analysis.variants[0].height, 1080);
  assert.equal(analysis.variants[0].uri, `${ADAPTIVE_URI_PREFIX}137`);
  assert.equal(analysis.variants[1].sourceKind, 'progressive');
  assert.equal(analysis.variants[1].uri, 'https://example.com/prog.mp4');
});

test('ytdlp analyzeYtDlpUrl: erro restrito vira YTDLP_ANALYZE_FAILED com needsAuth', async () => {
  fakeYtDlpImpl = async () => {
    const err = new Error('Sign in to confirm your age');
    err.stderr = 'ERROR: Sign in to confirm your age';
    throw err;
  };
  const mod = await import(`../../src/adapters/ytdlp.js?mock-auth=${Date.now()}`);

  await assert.rejects(
    mod.analyzeYtDlpUrl('https://www.youtube.com/watch?v=abc123'),
    (err) => {
      assert.equal(err.code, 'YTDLP_ANALYZE_FAILED');
      assert.equal(err.needsAuth, true);
      assert.match(err.message, /cookies/);
      return true;
    }
  );
});

test('ytdlp analyzeYtDlpUrl: sem formatos utilizaveis lanca YTDLP_FORMAT_UNAVAILABLE', async () => {
  fakeYtDlpImpl = async () => ({
    title: 'x',
    formats: [{ format_id: '1', vcodec: 'none', acodec: 'none', url: '' }],
  });
  const mod = await import(`../../src/adapters/ytdlp.js?mock-vazio=${Date.now()}`);

  await assert.rejects(
    mod.analyzeYtDlpUrl('https://www.youtube.com/watch?v=abc123'),
    (err) => {
      assert.equal(err.code, YTDLP_FORMAT_UNAVAILABLE);
      return true;
    }
  );
});
