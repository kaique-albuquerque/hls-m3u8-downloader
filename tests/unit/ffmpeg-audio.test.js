// P5 — Perfis de áudio (src/ffmpeg/audio.js). Unit, sem FFmpeg.
//
// Cobre: shapes dos perfis, regra "só remux vs exige transcode"
// (canRemuxToProfile) e conversão de perfil → args do FFmpeg
// (audioProfileToArgs), incluindo perfil desconhecido.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AUDIO_PROFILES,
  getAudioProfiles,
  canRemuxToProfile,
  audioProfileToArgs,
} from '../../src/ffmpeg/audio.js';

test('audio: AUDIO_PROFILES tem os 5 perfis com os campos esperados', () => {
  const ids = Object.keys(AUDIO_PROFILES);
  assert.deepEqual(ids, ['original', 'm4a', 'mp3', 'opus', 'flac']);
  for (const id of ids) {
    const p = AUDIO_PROFILES[id];
    assert.equal(p.id, id, `perfil ${id} deve ter id proprio`);
    assert.ok(typeof p.label === 'string' && p.label.length > 0, `label de ${id}`);
    assert.ok(typeof p.ext === 'string' && p.ext.length > 0, `ext de ${id}`);
    assert.ok(typeof p.description === 'string', `description de ${id}`);
  }
  assert.equal(AUDIO_PROFILES.original.codec, null, 'original nao tem codec (copy)');
  assert.equal(AUDIO_PROFILES.m4a.codec, 'aac');
  assert.equal(AUDIO_PROFILES.mp3.codec, 'libmp3lame');
  assert.equal(AUDIO_PROFILES.opus.codec, 'libopus');
  assert.equal(AUDIO_PROFILES.flac.codec, 'flac');
});

test('audio: getAudioProfiles retorna todos na ordem de exibicao', () => {
  const list = getAudioProfiles();
  assert.deepEqual(list.map((p) => p.id), ['original', 'm4a', 'mp3', 'opus', 'flac']);
});

test('audio: original aceita sempre copy (remux)', () => {
  assert.equal(canRemuxToProfile('original', 'aac'), true);
  assert.equal(canRemuxToProfile('original', 'opus'), true);
  assert.equal(canRemuxToProfile('original', ''), true);
});

test('audio: m4a aceita copy so com origem AAC/MP4A', () => {
  assert.equal(canRemuxToProfile('m4a', 'mp4a.40.2'), true, 'mp4a.40.2 e AAC');
  assert.equal(canRemuxToProfile('m4a', 'aac'), true);
  assert.equal(canRemuxToProfile('m4a', 'opus'), false);
  assert.equal(canRemuxToProfile('m4a', ''), false, 'codec desconhecido nao arrisca copy');
});

test('audio: mp3/opus/flac aceitam copy so quando a origem ja e compativel', () => {
  assert.equal(canRemuxToProfile('mp3', 'mp3'), true);
  assert.equal(canRemuxToProfile('mp3', 'libmp3lame'), true);
  assert.equal(canRemuxToProfile('mp3', 'aac'), false);
  assert.equal(canRemuxToProfile('opus', 'opus'), true);
  assert.equal(canRemuxToProfile('opus', 'aac'), false);
  assert.equal(canRemuxToProfile('flac', 'flac'), true);
  assert.equal(canRemuxToProfile('flac', 'aac'), false);
});

test('audio: perfil desconhecido retorna false em canRemuxToProfile', () => {
  assert.equal(canRemuxToProfile('wav', 'aac'), false);
  assert.equal(canRemuxToProfile(undefined, 'aac'), false);
});

test('audio: audioProfileToArgs(mp3) exige transcode com libmp3lame', () => {
  const r = audioProfileToArgs('mp3', {});
  assert.deepEqual(r.args, ['-vn', '-c:a', 'libmp3lame']);
  assert.equal(r.requiresTranscode, true);
  assert.equal(r.container, 'mp3');
  assert.equal(r.codec, 'libmp3lame');
});

test('audio: audioProfileToArgs(m4a) faz copy quando origem ja e AAC', () => {
  const r = audioProfileToArgs('m4a', { sourceCodec: 'mp4a.40.2' });
  assert.deepEqual(r.args, ['-vn', '-c:a', 'copy']);
  assert.equal(r.requiresTranscode, false);
  assert.equal(r.container, 'm4a');
  assert.equal(r.codec, 'copy');
});

test('audio: audioProfileToArgs(m4a) transcoda quando origem incompativel', () => {
  const r = audioProfileToArgs('m4a', { sourceCodec: 'opus' });
  assert.equal(r.requiresTranscode, true);
  assert.deepEqual(r.args, ['-vn', '-c:a', 'aac']);
});

test('audio: audioProfileToArgs(original) nunca recodifica', () => {
  const r = audioProfileToArgs('original', {});
  assert.equal(r.requiresTranscode, false);
  assert.deepEqual(r.args, ['-vn', '-c:a', 'copy']);
  assert.equal(r.container, 'mp4');
});

test('audio: audioProfileToArgs lanca para perfil desconhecido', () => {
  assert.throws(() => audioProfileToArgs('wav', {}), /Perfil de audio desconhecido: wav/);
});
