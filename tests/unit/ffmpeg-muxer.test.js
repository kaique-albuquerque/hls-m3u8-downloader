// P5 — Muxer (src/ffmpeg/muxer.js). Unit com service mockado.
//
// mock.module substitui o FfmpegService (spawn fake), então nenhum binário é
// necessário. Cobre: montagem dos args (buildDownloadArgs/buildMuxArgs),
// fallback de modos, headers, e o contrato legado de startDownload/
// startMuxDownload ({ promise, stop, mode }) + nomes canônicos remux/mux.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mock } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_URL = pathToFileURL(path.join(ROOT, 'src', 'ffmpeg', 'service.js')).href;

const runCalls = [];
mock.module(SERVICE_URL, {
  namedExports: {
    FfmpegService: class FfmpegService {},
    ffmpegService: {
      run: ({ args, onProgress, signal }) => {
        runCalls.push({ args, onProgress, signal });
        return { promise: Promise.resolve({ ok: true, code: 0, stderr: '', interrupted: false }), stop: () => {} };
      },
    },
  },
});

const { MODES, MODE_LABELS, buildDownloadArgs, buildMuxArgs, formatHeaders, startDownload, startMuxDownload, remux, mux } =
  await import(`../../src/ffmpeg/muxer.js?p5-muxer=${Date.now()}`);

test('muxer: MODES e MODE_LABELS em ordem e alinhados', () => {
  assert.equal(MODES.length, 3);
  assert.equal(MODE_LABELS.length, 3);
  assert.deepEqual(MODES.map((m) => m.name), ['copy', 'copy-adtstoasc', 'aac']);
  assert.match(MODE_LABELS[0], /copia direta/);
  assert.match(MODE_LABELS[1], /aac_adtstoasc/);
  assert.match(MODE_LABELS[2], /AAC/);
});

test('muxer: buildDownloadArgs modo copy (padrao)', () => {
  const args = buildDownloadArgs({ url: 'https://exemplo/a.mp4', output: 'out.mp4' });
  assert.equal(args[0], '-hide_banner');
  assert.deepEqual(args, [
    '-hide_banner', '-loglevel', 'error', '-nostats', '-y',
    '-i', 'https://exemplo/a.mp4',
    '-progress', 'pipe:1',
    '-c', 'copy',
    'out.mp4',
  ]);
});

test('muxer: buildDownloadArgs injeta headers e extraArgs antes do -i', () => {
  const args = buildDownloadArgs({
    url: 'u.m3u8',
    output: 'o.mp4',
    headers: { Referer: 'https://exemplo/', 'User-Agent': 'Mozilla' },
    modeIndex: 1,
    extraArgs: ['-allowed_extensions', 'ALL'],
  });
  const headersIdx = args.indexOf('-headers');
  assert.ok(headersIdx > 0, 'deve conter -headers');
  assert.equal(args[headersIdx + 1], 'Referer: https://exemplo/\r\nUser-Agent: Mozilla\r\n');
  assert.ok(args.indexOf('-i') > headersIdx, 'headers antes do -i');
  assert.equal(args[args.indexOf('-i') - 2], '-allowed_extensions');
  assert.equal(args[args.indexOf('-i') - 1], 'ALL');
  assert.deepEqual(args.slice(-5), ['-c', 'copy', '-bsf:a', 'aac_adtstoasc', 'o.mp4']);
});

test('muxer: buildDownloadArgs modo aac e fallback de modeIndex invalido', () => {
  const aac = buildDownloadArgs({ url: 'u', output: 'o', modeIndex: 2 });
  assert.ok(aac.includes('-c:a') && aac.includes('aac') && aac.includes('+faststart'));
  const fallback = buildDownloadArgs({ url: 'u', output: 'o', modeIndex: 99 });
  assert.ok(fallback.includes('-c') && fallback.includes('copy'));
  assert.ok(!fallback.includes('-c:a'));
});

test('muxer: buildMuxArgs mapeia video+audio com copy', () => {
  const args = buildMuxArgs({ videoInput: 'v.mp4', audioInput: 'a.m4a', output: 'out.mp4' });
  assert.ok(args.includes('-i') && args.includes('v.mp4') && args.includes('a.m4a'));
  assert.ok(args.includes('-map') && args.includes('0:v:0') && args.includes('1:a:0'));
  assert.ok(args.includes('-c:v') && args.includes('copy'));
  assert.ok(args.includes('-c:a') && args.includes('copy'));
  assert.equal(args[args.length - 1], 'out.mp4');
});

test('muxer: formatHeaders filtra vazios e separa com CRLF', () => {
  assert.equal(formatHeaders({}), '');
  assert.equal(formatHeaders({ A: '1', B: '' }), 'A: 1\r\n');
  assert.equal(formatHeaders({ A: '1', B: '2' }), 'A: 1\r\nB: 2\r\n');
});

test('muxer: startDownload delega ao service e preserva { promise, stop, mode }', async () => {
  runCalls.length = 0;
  const onProgress = () => {};
  const r = startDownload({ url: 'u', output: 'o', modeIndex: 2, onProgress });
  assert.equal(r.mode, MODES[2], 'mode refletido no retorno');
  assert.equal(typeof r.stop, 'function');
  assert.equal(typeof r.promise.then, 'function');
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].onProgress, onProgress);
  const res = await r.promise;
  assert.equal(res.ok, true);
});

test('muxer: startMuxDownload delega com buildMuxArgs', async () => {
  runCalls.length = 0;
  const { promise } = startMuxDownload({ videoInput: 'v', audioInput: 'a', output: 'o' });
  await promise;
  assert.equal(runCalls.length, 1);
  assert.ok(runCalls[0].args.includes('v') && runCalls[0].args.includes('a'));
});

test('muxer: remux e mux sao aliases canonicos', async () => {
  runCalls.length = 0;
  const a = remux({ url: 'u', output: 'o' });
  const b = mux({ videoInput: 'v', audioInput: 'a', output: 'o' });
  assert.equal(typeof a.promise.then, 'function');
  assert.equal(typeof b.promise.then, 'function');
  assert.equal(runCalls.length, 2);
  const remuxArgs = runCalls[0].args;
  assert.equal(remuxArgs[remuxArgs.length - 3], '-c');
  assert.equal(remuxArgs[remuxArgs.length - 2], 'copy');
  await Promise.all([a.promise, b.promise]);
});
