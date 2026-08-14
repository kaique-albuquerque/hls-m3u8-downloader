import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  JOB_STATES,
  JOB_TRANSITIONS,
  TERMINAL_JOB_STATES,
  isValidJobState,
  isTerminalJobState,
  canTransition,
  createFormat,
  isValidFormat,
  createMediaInfo,
  isValidMediaInfo,
  createDownloadJob,
  transitionJob,
  serializeJob,
  toJson,
  formatFromVariant,
} from '../../src/core/models.js';

// ---- JOB_STATES / transicoes ----

test('core-models JOB_STATES: contem todos os estados do ciclo de vida', () => {
  assert.deepEqual(JOB_STATES, [
    'queued',
    'analyzing',
    'preparing',
    'downloading',
    'paused',
    'merging',
    'completed',
    'failed',
    'cancelled',
  ]);
});

test('core-models TERMINAL_JOB_STATES: estados finais nao transicionam', () => {
  assert.deepEqual(TERMINAL_JOB_STATES, ['completed', 'failed', 'cancelled']);
  for (const terminal of TERMINAL_JOB_STATES) {
    assert.equal(isTerminalJobState(terminal), true);
    assert.deepEqual(JOB_TRANSITIONS[terminal], []);
  }
});

test('core-models isValidJobState: reconhece estados validos e rejeita invalidos', () => {
  for (const state of JOB_STATES) assert.equal(isValidJobState(state), true);
  assert.equal(isValidJobState('unknown'), false);
  assert.equal(isValidJobState(''), false);
  assert.equal(isValidJobState(null), false);
  assert.equal(isValidJobState(42), false);
});

test('core-models canTransition: cadeia principal queued -> completed', () => {
  const chain = ['queued', 'analyzing', 'preparing', 'downloading', 'merging', 'completed'];
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.equal(canTransition(chain[i], chain[i + 1]), true, `${chain[i]} -> ${chain[i + 1]}`);
  }
});

test('core-models canTransition: pausa/resume e caminhos de falha/cancelamento', () => {
  assert.equal(canTransition('downloading', 'paused'), true);
  assert.equal(canTransition('paused', 'downloading'), true);
  assert.equal(canTransition('downloading', 'failed'), true);
  assert.equal(canTransition('analyzing', 'failed'), true);
  assert.equal(canTransition('preparing', 'cancelled'), true);
  assert.equal(canTransition('downloading', 'cancelled'), true);
});

test('core-models canTransition: transicoes invalidas rejeitadas', () => {
  assert.equal(canTransition('queued', 'completed'), false);
  assert.equal(canTransition('queued', 'downloading'), false);
  assert.equal(canTransition('analyzing', 'queued'), false);
  assert.equal(canTransition('completed', 'queued'), false);
  assert.equal(canTransition('failed', 'downloading'), false);
  assert.equal(canTransition('cancelled', 'queued'), false);
  assert.equal(canTransition('downloading', 'preparing'), false);
  assert.equal(canTransition('paused', 'completed'), false);
});

// ---- Format ----

test('core-models createFormat: normaliza shape dos adapters (ytdlp)', () => {
  const format = createFormat({
    formatId: '137',
    url: 'https://example.com/v137.mp4',
    container: 'mp4',
    codecs: 'avc1.640028, mp4a.40.2',
    qualityLabel: '1080p',
    bitrate: 2500,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: false,
    contentLength: 4567890,
  });
  assert.equal(format.formatId, '137');
  assert.equal(format.url, 'https://example.com/v137.mp4');
  assert.equal(format.container, 'mp4');
  assert.equal(format.codecs, 'avc1.640028, mp4a.40.2');
  assert.equal(format.qualityLabel, '1080p');
  assert.equal(format.bitrate, 2500);
  assert.equal(format.width, 1920);
  assert.equal(format.height, 1080);
  assert.equal(format.hasVideo, true);
  assert.equal(format.hasAudio, false);
  assert.equal(format.contentLength, 4567890);
  assert.equal(isValidFormat(format), true);
});

test('core-models createFormat: campos ausentes viram neutros (nao lanca)', () => {
  const format = createFormat({ url: 'https://example.com/x.mp4' });
  assert.equal(format.formatId, '');
  assert.equal(format.container, '');
  assert.equal(format.qualityLabel, '');
  assert.equal(format.bitrate, 0);
  assert.equal(format.width, 0);
  assert.equal(format.height, 0);
  assert.equal(format.hasVideo, false);
  assert.equal(format.hasAudio, false);
  assert.equal(format.contentLength, 0);
  assert.equal(isValidFormat(format), true);
});

test('core-models createFormat: deriva hasVideo/hasAudio de vcodec/acodec', () => {
  const withCodecs = createFormat({ vcodec: 'avc1', acodec: 'none' });
  assert.equal(withCodecs.hasVideo, true);
  assert.equal(withCodecs.hasAudio, false);
  const both = createFormat({ vcodec: 'avc1', acodec: 'mp4a.40.2' });
  assert.equal(both.hasVideo, true);
  assert.equal(both.hasAudio, true);
});

test('core-models createFormat: entrada invalida lanca TypeError', () => {
  assert.throws(() => createFormat(null), TypeError);
  assert.throws(() => createFormat('nope'), TypeError);
  assert.throws(() => createFormat(42), TypeError);
});

test('core-models isValidFormat: rejeita objetos sem o shape', () => {
  assert.equal(isValidFormat(null), false);
  assert.equal(isValidFormat({}), false);
  assert.equal(isValidFormat({ formatId: 1 }), false);
});

test('core-models formatFromVariant: variant HLS vira Format normalizado', () => {
  const variant = {
    uri: 'https://example.com/media.m3u8',
    resolution: '720x1280',
    width: 720,
    height: 1280,
    bandwidth: 2500000,
    codecs: 'avc1.640028,mp4a.40.2',
  };
  const format = formatFromVariant(variant);
  assert.equal(format.url, variant.uri);
  assert.equal(format.qualityLabel, '720x1280');
  assert.equal(format.bitrate, 2500000);
  assert.equal(format.height, 1280);
  assert.equal(format.hasVideo, true);
  assert.equal(format.hasAudio, true);
  assert.equal(isValidFormat(format), true);
});

// ---- MediaInfo ----

test('core-models createMediaInfo: normaliza analise de adapter', () => {
  const info = createMediaInfo({
    kind: 'ytdlp',
    pageUrl: 'https://www.youtube.com/watch?v=abc123',
    title: 'Vídeo de Teste StreamGrab',
    videoId: 'abc123',
    durationSeconds: 125,
    progressiveFormats: [
      { formatId: '18', url: 'https://example.com/prog.mp4', container: 'mp4', height: 360, hasVideo: true, hasAudio: true },
    ],
    adaptiveVideoFormats: [
      { formatId: '137', url: 'https://example.com/v137.mp4', container: 'mp4', height: 1080, hasVideo: true, hasAudio: false },
    ],
    adaptiveAudioFormats: [
      { formatId: '140', url: 'https://example.com/a140.m4a', container: 'm4a', hasVideo: false, hasAudio: true },
    ],
  });
  assert.equal(info.kind, 'ytdlp');
  assert.equal(info.sourceType, 'ytdlp');
  assert.equal(info.title, 'Vídeo de Teste StreamGrab');
  assert.equal(info.durationSeconds, 125);
  assert.equal(info.formats.length, 3);
  assert.equal(info.progressiveFormats.length, 1);
  assert.equal(info.adaptiveVideoFormats.length, 1);
  assert.equal(info.adaptiveAudioFormats.length, 1);
  assert.equal(isValidMediaInfo(info), true);
});

test('core-models createMediaInfo: aceita formats prontos e variants', () => {
  const info = createMediaInfo({
    kind: 'master',
    title: 'Playlist',
    formats: [{ formatId: 'a', url: 'https://example.com/a.mp4' }],
    variants: [{ uri: 'https://example.com/v.m3u8', resolution: '720p' }],
  });
  assert.equal(info.formats.length, 1);
  assert.equal(info.formats[0].formatId, 'a');
  assert.equal(info.variants.length, 1);
  assert.equal(info.sourceType, 'master');
  assert.equal(isValidMediaInfo(info), true);
});

test('core-models createMediaInfo: entrada invalida lanca TypeError', () => {
  assert.throws(() => createMediaInfo(null), TypeError);
  assert.throws(() => createMediaInfo('x'), TypeError);
});

// ---- DownloadJob ----

test('core-models createDownloadJob: estado inicial queued e shape', () => {
  const job = createDownloadJob({ url: 'https://example.com/v.mp4' });
  assert.equal(job.state, 'queued');
  assert.equal(job.url, 'https://example.com/v.mp4');
  assert.equal(job.title, '');
  assert.equal(job.error, null);
  assert.match(job.id, /^job-/, 'ID comeca com job-');
  assert.ok(job.id.length > 5, 'ID tem comprimento razoavel (timestamp+random)');
  assert.equal(job.createdAt, job.updatedAt);
  assert.equal(job.history.length, 1);
  assert.deepEqual(job.history[0], { from: null, to: 'queued', at: job.createdAt });
  assert.equal(isValidJobState(job.state), true);
});

test('core-models createDownloadJob: url obrigatoria e meta copiada', () => {
  assert.throws(() => createDownloadJob({}), TypeError);
  assert.throws(() => createDownloadJob({ url: '' }), TypeError);
  assert.throws(() => createDownloadJob({ url: 42 }), TypeError);
  const meta = { sourceType: 'hls' };
  const job = createDownloadJob({ url: 'https://example.com/v.m3u8', meta });
  meta.sourceType = 'mutated';
  assert.equal(job.meta.sourceType, 'hls', 'meta deve ser copiado (nao referencia)');
});

test('core-models transitionJob: cadeia completa valida e historico gravado', () => {
  const job = createDownloadJob({ url: 'https://example.com/v.mp4', title: 'Aula 1' });
  transitionJob(job, 'analyzing');
  transitionJob(job, 'preparing');
  transitionJob(job, 'downloading');
  transitionJob(job, 'merging');
  transitionJob(job, 'completed');
  assert.equal(job.state, 'completed');
  assert.equal(job.history.length, 6);
  const states = job.history.map((h) => h.to);
  assert.deepEqual(states, ['queued', 'analyzing', 'preparing', 'downloading', 'merging', 'completed']);
});

test('core-models transitionJob: pausa/resume', () => {
  const job = createDownloadJob({ url: 'https://example.com/v.mp4' });
  transitionJob(job, 'analyzing');
  transitionJob(job, 'preparing');
  transitionJob(job, 'downloading');
  transitionJob(job, 'paused');
  assert.equal(job.state, 'paused');
  transitionJob(job, 'downloading');
  assert.equal(job.state, 'downloading');
});

test('core-models transitionJob: falha grava erro serializado', () => {
  const job = createDownloadJob({ url: 'https://example.com/v.mp4' });
  transitionJob(job, 'analyzing');
  const err = new Error('Falha de rede');
  err.code = 'NETWORK_ERROR';
  err.needsAuth = false;
  transitionJob(job, 'failed', { error: err });
  assert.equal(job.state, 'failed');
  assert.deepEqual(job.error, {
    message: 'Falha de rede',
    code: 'NETWORK_ERROR',
    needsAuth: false,
    status: 0,
  });
});

test('core-models transitionJob: cancelamento a partir de estados ativos', () => {
  for (const from of ['queued', 'analyzing', 'preparing', 'downloading', 'paused']) {
    const job = createDownloadJob({ url: 'https://example.com/v.mp4' });
    const viaChain = ['analyzing', 'preparing', 'downloading', 'paused'];
    const idx = viaChain.indexOf(from);
    for (let i = 0; i < idx; i += 1) transitionJob(job, viaChain[i]);
    transitionJob(job, 'cancelled');
    assert.equal(job.state, 'cancelled', `cancelled a partir de ${from}`);
    assert.equal(isTerminalJobState(job.state), true);
  }
});

test('core-models transitionJob: transicao invalida lanca com code', () => {
  const job = createDownloadJob({ url: 'https://example.com/v.mp4' });
  assert.throws(() => transitionJob(job, 'completed'), (err) => err.code === 'INVALID_JOB_TRANSITION');
  assert.throws(() => transitionJob(job, 'bogus'), (err) => err.code === 'INVALID_JOB_STATE');
  assert.equal(job.state, 'queued', 'job permanece no estado anterior apos falha');
});

test('core-models transitionJob: estados terminais nao aceitam novas transicoes', () => {
  const job = createDownloadJob({ url: 'https://example.com/v.mp4' });
  transitionJob(job, 'analyzing');
  transitionJob(job, 'failed');
  assert.throws(() => transitionJob(job, 'queued'), (err) => err.code === 'INVALID_JOB_TRANSITION');
  assert.equal(job.state, 'failed');
});

// ---- Serializacao limpa ----

test('core-models serializeJob: JSON sem campos circulares e sem funcoes', () => {
  const job = createDownloadJob({ url: 'https://example.com/v.mp4', meta: { sourceType: 'hls' } });
  transitionJob(job, 'analyzing');
  const json = JSON.stringify(serializeJob(job));
  const parsed = JSON.parse(json);
  assert.equal(parsed.id, job.id);
  assert.equal(parsed.url, job.url);
  assert.equal(parsed.state, 'analyzing');
  assert.equal(parsed.meta.sourceType, 'hls');
  assert.equal(parsed.history.length, 2);
  assert.ok(!json.includes('function'), 'serializacao nao deve conter funcoes');
  assert.ok(!json.includes('[object'), 'serializacao nao deve conter objetos nao serializados');
});

test('core-models toJson: alias de serializeJob produz objeto plano', () => {
  const job = createDownloadJob({ url: 'https://example.com/v.mp4' });
  const plain = toJson(job);
  assert.deepEqual(plain, serializeJob(job));
  assert.ok(plain !== job, 'nao deve retornar a mesma referencia do job');
  assert.equal(typeof plain.transitionJob, 'undefined');
});
