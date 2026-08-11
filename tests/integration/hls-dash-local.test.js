// Integration: HLS local fixture + DASH local fixture + FFmpeg.
//
// Cobre (plano §28 - Integration):
//  - HLS local fixture (gera HLS real com FFmpeg, serve via HTTP local,
//    baixa com startDownload e valida o MP4 de saida)
//  - DASH local fixture (gera DASH real com FFmpeg, serve via HTTP local,
//    baixa com startDownload e valida o MP4 de saida)
//  - fallback de transport (modos do FFmpeg: copy -> adtstoasc -> aac)
//
// Sem rede externa. Pula se o FFmpeg nao estiver disponivel (checkFfmpeg).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { checkFfmpeg, getFfmpegCommand, startDownload } from '../../src/ffmpeg.js';
import { fetchPlaylist, parsePlaylistText, parseSegmentPlaylist } from '../../src/hls.js';
import { fetchDashManifest } from '../../src/dash.js';

const HAS_FFMPEG = await checkFfmpeg();

function ffmpeg(args, opts = {}) {
  return spawnSync(getFfmpegCommand(), args, { windowsHide: true, encoding: 'utf8', ...opts });
}

function startServer(rootDir) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(rootDir, urlPath);
    if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Length': data.length });
    res.end(data);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// keyinfo do FFmpeg: linha1 = caminho da chave (relativo ao CWD), linha2 = URI,
// linha3 = IV **sem** prefixo 0x (o FFmpeg adiciona sozinho).
function writeKeyinfo(dir) {
  fs.writeFileSync(path.join(dir, 'key.bin'), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
  fs.writeFileSync(
    path.join(dir, 'keyinfo.txt'),
    ['key.bin', 'key.bin', '0102030405060708090a0b0c0d0e0f10', ''].join('\n')
  );
}

test('ffmpeg: getFfmpegCommand e checkFfmpeg consistentes com o ambiente', () => {
  const cmd = getFfmpegCommand();
  assert.equal(typeof cmd, 'string');
  assert.ok(cmd.length > 0, 'comando nao pode ser vazio');
  assert.equal(typeof HAS_FFMPEG, 'boolean');
  // Se o vendor estiver pronto, o caminho aponta para o binario local.
  const vendorOk = fs.existsSync(path.join(process.cwd(), 'vendor', 'ffmpeg', 'ffmpeg.exe'))
    && fs.existsSync(path.join(process.cwd(), 'vendor', 'ffmpeg', '.installed'));
  if (vendorOk) {
    assert.ok(cmd.includes('ffmpeg'), `esperado caminho do vendor, obtido: ${cmd}`);
    assert.equal(HAS_FFMPEG, true, 'com vendor presente, checkFfmpeg deve ser true');
  }
});

test('ffmpeg: baixa MPEG-TS criptografado (AES-128) de servidor local', { skip: !HAS_FFMPEG }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-hls-'));
  writeKeyinfo(dir);

  const gen = ffmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '15', '-c:a', 'aac',
    '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0',
    '-hls_key_info_file', 'keyinfo.txt',
    '-hls_segment_filename', 'seg%d.ts', 'media.m3u8',
  ], { cwd: dir });
  assert.equal(gen.status, 0, `geracao do HLS falhou: ${gen.stderr || gen.stdout}`);

  const { server, port } = await startServer(dir);
  try {
    const base = `http://127.0.0.1:${port}`;

    // master/media: baixa o texto e interpreta os segmentos
    const res = await fetchPlaylist(`${base}/media.m3u8`);
    assert.equal(res.kind, 'media', 'fetchPlaylist deve classificar como media');
    const text = await (await fetch(`${base}/media.m3u8`)).text();
    const parsed = parseSegmentPlaylist(text);
    assert.ok(parsed.segments.length >= 3, `esperado >= 3 segmentos, obtido ${parsed.segments.length}`);
    assert.equal(parsed.keys.length, 1, 'chave AES-128 detectada');
    assert.ok(parsed.segments.every((s) => s.key), 'todo segmento deve carregar a chave ativa');

    // download do HLS completo com FFmpeg (modo copy)
    const output = path.join(dir, 'out.mp4');
    const { promise } = startDownload({
      url: `${base}/media.m3u8`,
      output,
      extraArgs: ['-allowed_extensions', 'ALL'],
      onProgress: () => {},
    });
    const result = await promise;
    assert.equal(result.ok, true, `download HLS falhou: ${result.stderr || ''}`);
    assert.ok(fs.existsSync(output) && fs.statSync(output).size > 0, 'MP4 de saida deve existir e nao ser vazio');
    // moov atom presente (validacao basica de mp4)
    const head = fs.readFileSync(output).subarray(0, 64).toString('latin1');
    assert.ok(head.includes('ftyp'), `MP4 deve ter box ftyp (${head.slice(0, 16)})`);
  } finally {
    await stopServer(server);
  }
});

test('ffmpeg: baixa fMP4 (EXT-X-MAP) de servidor local', { skip: !HAS_FFMPEG }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-fmp4-'));
  const gen = ffmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '15', '-c:a', 'aac',
    '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', 'seg%d.mp4', 'media.m3u8',
  ], { cwd: dir });
  assert.equal(gen.status, 0, `geracao do fMP4 falhou: ${gen.stderr || gen.stdout}`);

  const { server, port } = await startServer(dir);
  try {
    const base = `http://127.0.0.1:${port}`;
    const res = await fetchPlaylist(`${base}/media.m3u8`);
    assert.equal(res.kind, 'media');
    const text = await (await fetch(`${base}/media.m3u8`)).text();
    const parsed = parseSegmentPlaylist(text);
    assert.ok(parsed.maps.length >= 1, 'EXT-X-MAP detectado na playlist');
    assert.ok(parsed.segments.length >= 3, 'segmentos detectados');

    const output = path.join(dir, 'out.mp4');
    const { promise } = startDownload({
      url: `${base}/media.m3u8`,
      output,
      extraArgs: ['-allowed_extensions', 'ALL'],
      onProgress: () => {},
    });
    const result = await promise;
    assert.equal(result.ok, true, `download fMP4 falhou: ${result.stderr || ''}`);
    assert.ok(fs.existsSync(output) && fs.statSync(output).size > 0, 'MP4 de saida deve existir');
  } finally {
    await stopServer(server);
  }
});

test('ffmpeg: baixa DASH local (manifest.mpd) de servidor local', { skip: !HAS_FFMPEG }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-dash-'));
  const gen = ffmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-c:a', 'aac',
    '-f', 'dash', '-seg_duration', '1', '-window_size', '0',
    '-init_seg_name', 'init-$RepresentationID$.mp4',
    '-media_seg_name', 'seg-$RepresentationID$-$Number$.m4s',
    'manifest.mpd',
  ], { cwd: dir });
  assert.equal(gen.status, 0, `geracao do DASH falhou: ${gen.stderr || gen.stdout}`);

  const { server, port } = await startServer(dir);
  try {
    const base = `http://127.0.0.1:${port}`;
    // fetchDashManifest ja retorna o manifesto parseado (sem campo .text)
    const parsed = await fetchDashManifest(`${base}/manifest.mpd`);
    assert.equal(parsed.kind, 'dash');
    assert.ok(parsed.videoRepresentations.length >= 1, 'representacoes de video detectadas');
    assert.equal(parsed.representations.length >= 2, true, 'video + audio esperados');
    assert.equal(parsed.videoRepresentations[0].height, 240, 'melhor representacao = 240p');

    const output = path.join(dir, 'out.mp4');
    const { promise } = startDownload({
      url: `${base}/manifest.mpd`,
      output,
      extraArgs: ['-allowed_extensions', 'ALL'],
      onProgress: () => {},
    });
    const result = await promise;
    assert.equal(result.ok, true, `download DASH falhou: ${result.stderr || ''}`);
    assert.ok(fs.existsSync(output) && fs.statSync(output).size > 0, 'MP4 de saida deve existir');
  } finally {
    await stopServer(server);
  }
});

test('ffmpeg: fallback de modos - URL inexistente falha em todos os modos', { skip: !HAS_FFMPEG }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-it-fail-'));
  const output = path.join(dir, 'out.mp4');
  const { promise } = startDownload({
    url: 'http://127.0.0.1:1/nao-existe.m3u8', // porta 1 = conexao recusada
    output,
    onProgress: () => {},
  });
  const result = await promise;
  assert.equal(result.ok, false, 'download deve falhar');
  assert.equal(result.interrupted, false);
  assert.equal(fs.existsSync(output), false, 'nao deve sobrar arquivo parcial');
});
