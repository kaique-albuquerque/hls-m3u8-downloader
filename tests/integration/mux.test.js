// Integration: FFmpeg mux (startMuxDownload).
//
// Gera video-only + audio-only com FFmpeg (lavfi), junta via startMuxDownload
// e valida que a saida tem video + audio (via -i no FFmpeg, sem depender de
// ffprobe). Sem rede externa. Pula se o FFmpeg nao estiver disponivel.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { checkFfmpeg, getFfmpegCommand, startMuxDownload } from '../../src/ffmpeg.js';

const HAS_FFMPEG = await checkFfmpeg();

function ffmpeg(args, opts = {}) {
  return spawnSync(getFfmpegCommand(), args, { windowsHide: true, encoding: 'utf8', ...opts });
}

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-mux-'));
}

test('ffmpeg: startMuxDownload junta video + audio em MP4', { skip: !HAS_FFMPEG }, async () => {
  const dir = makeDir();
  const video = path.join(dir, 'video.mp4');
  const audio = path.join(dir, 'audio.m4a');
  const output = path.join(dir, 'out.mp4');

  const genV = ffmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-an', video,
  ]);
  assert.equal(genV.status, 0, `geracao do video falhou: ${genV.stderr || genV.stdout}`);

  const genA = ffmpeg([
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:a', 'aac', audio,
  ]);
  assert.equal(genA.status, 0, `geracao do audio falhou: ${genA.stderr || genA.stdout}`);

  const { promise } = startMuxDownload({ videoInput: video, audioInput: audio, output, onProgress: () => {} });
  const result = await promise;
  assert.equal(result.ok, true, `mux falhou: ${result.stderr || ''}`);
  assert.ok(fs.existsSync(output) && fs.statSync(output).size > 0, 'MP4 de saida deve existir');

  // valida streams com o proprio FFmpeg (-i imprime info e sai com status 1,
  // entao usamos a saida de stderr que contem as linhas Stream #0:x)
  const probe = ffmpeg(['-hide_banner', '-i', output]);
  const out = `${probe.stderr || ''}${probe.stdout || ''}`;
  assert.ok(/Stream #0:0[^:]*: Video/.test(out), `esperado stream de video, obtido:\n${out}`);
  assert.ok(/Stream #0:1[^:]*: Audio/.test(out), `esperado stream de audio, obtido:\n${out}`);
});

test('ffmpeg: startMuxDownload falha com entrada inexistente', { skip: !HAS_FFMPEG }, async () => {
  const dir = makeDir();
  const { promise } = startMuxDownload({
    videoInput: path.join(dir, 'nao-existe.mp4'),
    audioInput: path.join(dir, 'nao-existe.m4a'),
    output: path.join(dir, 'out.mp4'),
    onProgress: () => {},
  });
  const result = await promise;
  assert.equal(result.ok, false, 'mux com entrada inexistente deve falhar');
  assert.equal(result.interrupted, false);
});

test('ffmpeg: startMuxDownload stop() interrompe o processo', { skip: !HAS_FFMPEG }, async () => {
  const dir = makeDir();
  const video = path.join(dir, 'video.mp4');
  const audio = path.join(dir, 'audio.m4a');
  const output = path.join(dir, 'out.mp4');

  // conteudo longo o suficiente para o stop() chegar durante o mux
  ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=duration=20:size=640x360:rate=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-an', video]);
  ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:a', 'aac', audio]);

  const { promise, stop } = startMuxDownload({ videoInput: video, audioInput: audio, output, onProgress: () => {} });
  // stop() sincrono: o processo nao pode concluir no mesmo tick, entao
  // interrupted fica marcado antes do close (deterministico).
  stop();
  const result = await promise;
  assert.equal(result.ok, false, 'mux interrompido nao deve concluir ok');
  assert.equal(result.interrupted, true, 'stop() deve marcar interrupted');
});
