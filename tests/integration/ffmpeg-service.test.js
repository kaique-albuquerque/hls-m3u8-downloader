// P5 — Integração FFmpeg real (FfmpegService/muxer/audio).
//
// Gera fixtures com o próprio FFmpeg (lavfi — sem rede externa) e valida:
//  - remux via FfmpegService.run com progresso por eventos;
//  - remux via muxer (startDownload/remux);
//  - extração de áudio-only (MP3 transcode e original com copy);
//  - cancelamento (stop()) interrompe o processo e cleanupPartial limpa o
//    arquivo parcial.
// Pula se o FFmpeg não estiver disponível (mesma convenção de mux.test.js).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { FfmpegService, getFfmpegCommand, checkFfmpeg } from '../../src/ffmpeg.js';
import { startDownload, startMuxDownload, remux } from '../../src/ffmpeg/muxer.js';
import { audioProfileToArgs } from '../../src/ffmpeg/audio.js';
import { cleanupPartial } from '../../src/cli/download.js';

const HAS_FFMPEG = await checkFfmpeg();

function ffmpeg(args, opts = {}) {
  return spawnSync(getFfmpegCommand(), args, { windowsHide: true, encoding: 'utf8', ...opts });
}

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-ffmpeg-'));
}

/** Gera um MP4 pequeno (video h264 + audio aac) via lavfi. */
function makeFixtureMp4(dir, { duration = 1 } = {}) {
  const input = path.join(dir, 'fixture.mp4');
  const gen = ffmpeg([
    '-y', '-f', 'lavfi', '-i', `testsrc=duration=${duration}:size=160x120:rate=10`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-shortest',
    input,
  ]);
  assert.equal(gen.status, 0, `geracao da fixture falhou: ${gen.stderr || gen.stdout}`);
  return input;
}

function probeStreams(file) {
  const probe = ffmpeg(['-hide_banner', '-i', file]);
  return `${probe.stderr || ''}${probe.stdout || ''}`;
}

test('ffmpeg: FfmpegService.run remuxa fixture com progresso por eventos', { skip: !HAS_FFMPEG }, async () => {
  const dir = makeDir();
  const input = makeFixtureMp4(dir);
  const output = path.join(dir, 'remux.mp4');
  const service = new FfmpegService();
  const progress = [];

  const { promise } = service.run({
    args: ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-i', input, '-progress', 'pipe:1', '-c', 'copy', output],
    onProgress: (kv) => progress.push(kv),
  });
  const result = await promise;
  assert.equal(result.ok, true, `remux falhou: ${result.stderr || ''}`);
  assert.ok(fs.existsSync(output) && fs.statSync(output).size > 0, 'saida deve existir');
  assert.ok(progress.length > 0, 'progresso deve ser emitido via eventos');
  assert.ok(progress.some((kv) => kv.key === 'out_time_us' || kv.key === 'progress'), 'eventos chave/valor do -progress');
  const out = probeStreams(output);
  assert.ok(/Stream #0:0[^:]*: Video/.test(out), `esperado video:\n${out}`);
  assert.ok(/Stream #0:1[^:]*: Audio/.test(out), `esperado audio:\n${out}`);
});

test('ffmpeg: muxer.remux (modo copy) gera MP4 valido', { skip: !HAS_FFMPEG }, async () => {
  const dir = makeDir();
  const input = makeFixtureMp4(dir);
  const output = path.join(dir, 'remux-muxer.mp4');

  const { promise, stop } = remux({ url: input, output, onProgress: () => {} });
  const result = await promise;
  assert.equal(result.ok, true, `remux falhou: ${result.stderr || ''}`);
  assert.equal(typeof stop, 'function');
  const out = probeStreams(output);
  assert.ok(/Stream #0:0[^:]*: Video/.test(out), `esperado video:\n${out}`);
  assert.ok(/Stream #0:1[^:]*: Audio/.test(out), `esperado audio:\n${out}`);
});

test('ffmpeg: startMuxDownload junta video+audio separados', { skip: !HAS_FFMPEG }, async () => {
  const dir = makeDir();
  const video = path.join(dir, 'v.mp4');
  const audio = path.join(dir, 'a.m4a');
  const output = path.join(dir, 'mux.mp4');
  assert.equal(ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10', '-c:v', 'libx264', '-preset', 'ultrafast', '-an', video]).status, 0);
  assert.equal(ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', audio]).status, 0);

  const { promise } = startMuxDownload({ videoInput: video, audioInput: audio, output, onProgress: () => {} });
  const result = await promise;
  assert.equal(result.ok, true, `mux falhou: ${result.stderr || ''}`);
  const out = probeStreams(output);
  assert.ok(/Stream #0:0[^:]*: Video/.test(out), `esperado video:\n${out}`);
  assert.ok(/Stream #0:1[^:]*: Audio/.test(out), `esperado audio:\n${out}`);
});

test('ffmpeg: audio-only mp3 gera MP3 valido (transcode)', { skip: !HAS_FFMPEG }, async () => {
  const dir = makeDir();
  const input = makeFixtureMp4(dir);
  const output = path.join(dir, 'audio.mp3');
  const { args, requiresTranscode, container } = audioProfileToArgs('mp3', { sourceCodec: 'aac' });
  assert.equal(requiresTranscode, true, 'mp3 a partir de aac exige transcode');
  assert.equal(container, 'mp3');

  const gen = ffmpeg(['-y', '-i', input, ...args, output]);
  assert.equal(gen.status, 0, `extracao mp3 falhou: ${gen.stderr || gen.stdout}`);
  assert.ok(fs.existsSync(output) && fs.statSync(output).size > 0, 'mp3 deve existir');
  // valida como audio decodificavel (sem video e sem erros)
  const r = ffmpeg(['-hide_banner', '-i', output, '-f', 'null', '-']);
  assert.equal(r.status, 0, `mp3 invalido: ${r.stderr || r.stdout}`);
});

test('ffmpeg: perfil original faz copy sem recodificar', { skip: !HAS_FFMPEG }, async () => {
  const dir = makeDir();
  const input = makeFixtureMp4(dir);
  const output = path.join(dir, 'original.m4a');
  const { args, requiresTranscode } = audioProfileToArgs('original', { sourceCodec: 'aac' });
  assert.equal(requiresTranscode, false, 'original nunca recodifica');

  const gen = ffmpeg(['-y', '-i', input, ...args, output]);
  assert.equal(gen.status, 0, `extracao original falhou: ${gen.stderr || gen.stdout}`);
  assert.ok(fs.existsSync(output) && fs.statSync(output).size > 0, 'saida deve existir');
  const r = ffmpeg(['-hide_banner', '-i', output, '-f', 'null', '-']);
  assert.equal(r.status, 0, `audio original invalido: ${r.stderr || r.stdout}`);
});

test('ffmpeg: cancelamento (stop) interrompe processo e cleanupPartial remove parcial', { skip: !HAS_FFMPEG }, async () => {
  const dir = makeDir();
  const input = makeFixtureMp4(dir, { duration: 20 });
  const output = path.join(dir, 'cancelado.mp4');

  const { promise, stop } = startDownload({ url: input, output, onProgress: () => {} });
  stop(); // sincrono: interrupted fica marcado antes do close
  const result = await promise;
  assert.equal(result.ok, false, 'interrompido nao conclui ok');
  assert.equal(result.interrupted, true, 'stop() deve marcar interrupted');

  // simula arquivo parcial e valida o cleanup
  fs.writeFileSync(`${output}.part`, 'parcial');
  cleanupPartial(`${output}.part`);
  assert.equal(fs.existsSync(`${output}.part`), false, '.part removido pelo cleanupPartial');
});
