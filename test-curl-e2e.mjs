// Teste E2E do modo curl-impersonate:
// 1) Gera HLS real (master + media + segmentos) com FFmpeg
// 2) Sobe um servidor HTTP local servindo esse HLS
// 3) Cria um "curl_impersonate" fake (cópia do curl.exe do Windows) em tools/
// 4) Executa node src/index.js --curl-impersonate com stdin via pipe
// 5) Verifica o MP4 de saída e a limpeza dos temporários
//
// Cenários: (a) MPEG-TS com criptografia AES-128; (b) fMP4 com EXT-X-MAP.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePlaylistText, parseSegmentPlaylist } from './src/hls.js';
import { parseDashManifest } from './src/dash.js';
import { findCurlImpersonate } from './src/curlimp.js';
import { resolveSourceAdapter } from './src/source-adapters.js';
import {
  extractMdstrmVideoId,
  buildPlayerUrl,
  isMdstrmUrl,
  needsMdstrmRefresh,
} from './src/mdstrm.js';
import { detectSourceType, isYouTubeUrl } from './src/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const E2E_DIR = path.join(os.tmpdir(), 'vd-e2e');
const OUT_DIR = path.join(os.tmpdir(), 'vd-e2e-out');
const TOOLS_DIR = path.join(ROOT, 'tools');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) failures++;
};

// ---- 0) unidade: parseSegmentPlaylist + parsePlaylistText (criptografia) ----
{
  const encText = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI="key.bin?token=abc",IV=0x00000000000000000000000000000001
#EXTINF:6.006000,
seg0.ts?t=1
#EXTINF:6.006000,
seg1.ts
#EXT-X-ENDLIST`;
  const p = parseSegmentPlaylist(encText);
  ok(p.segments.length === 2, `parseSegmentPlaylist: 2 segmentos (${p.segments.length})`);
  ok(p.keys.length === 1 && p.keys[0].uri === 'key.bin?token=abc', `parseSegmentPlaylist: chave AES-128 detectada (${p.keys[0]?.uri})`);
  ok(p.segments[0].key?.uri === 'key.bin?token=abc', 'parseSegmentPlaylist: segmento carrega a chave ativa');
  ok(p.targetDuration === 6, `parseSegmentPlaylist: targetDuration (${p.targetDuration})`);

  const masterText = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"
media.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180,CODECS="avc1.42e01e,mp4a.40.2"
media.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"
../v7/media.m3u8`;
  const m = parsePlaylistText(masterText, 'https://cdn.x.com/a/b/master.m3u8');
  ok(m.kind === 'master' && m.variants.length === 2, `parsePlaylistText: master deduplicada e ordenada (${m.variants.length})`);
  ok(m.variants[0].height === 720, `parsePlaylistText: melhor variante = 720p (${m.variants[0].height})`);
  ok(m.variants[0].codecs === 'avc1.640028,mp4a.40.2', `parsePlaylistText: codecs com vírgula preservado (${m.variants[0].codecs})`);

  const dashText = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation id="v1" bandwidth="400000" width="640" height="360" codecs="avc1.64001e">
        <BaseURL>video-360.mp4</BaseURL>
      </Representation>
      <Representation id="v2" bandwidth="900000" width="1280" height="720" codecs="avc1.640028">
        <BaseURL>video-720.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
  const d = parseDashManifest(dashText, 'https://cdn.x.com/a/b/manifest.mpd');
  ok(d.kind === 'dash', `parseDashManifest: tipo dash (${d.kind})`);
  ok(d.videoRepresentations.length === 2, `parseDashManifest: 2 representações de vídeo (${d.videoRepresentations.length})`);
  ok(d.videoRepresentations[0].height === 720, `parseDashManifest: melhor representação = 720p (${d.videoRepresentations[0].height})`);
  ok(isYouTubeUrl('https://www.youtube.com/watch?v=abc123') === true, 'utils: detecta URL do YouTube');
  ok(detectSourceType('https://www.youtube.com/watch?v=abc123') === 'youtube', 'utils: tipo youtube');
  ok(resolveSourceAdapter('https://www.youtube.com/watch?v=abc123').id === 'youtube', 'source-adapters: roteia para adaptador youtube');

  // ---- 0.1) unidade: mdstrm (extração de videoId + URL do player) ----
  const cdnUrl = 'https://us-b4-p-e-qg12.cdn.mdstrm.com/video/h/5e6f83ae335cdd1163e16b5b/6a03573096d73ba91827573a_6a03573096d73ba91827574b.mp4/index-v1-a1.m3u8?cP=2063000&pid=abc&sid=def&uid=ghi';
  ok(extractMdstrmVideoId(cdnUrl) === '6a03573096d73ba91827573a', `mdstrm: videoId extraído do CDN (${extractMdstrmVideoId(cdnUrl)})`);
  ok(extractMdstrmVideoId('https://mdstrm.com/video/6a03573096d73ba91827573a.m3u8?at=web-app&uid=x&sid=y&pid=z&av=v7.0.86') === '6a03573096d73ba91827573a', 'mdstrm: videoId extraído da URL do player');
  ok(isMdstrmUrl(cdnUrl) === true, 'mdstrm: CDN detectado como mdstrm');
  ok(needsMdstrmRefresh(cdnUrl) === true, 'mdstrm: URL crua do CDN precisa de refresh');
  ok(needsMdstrmRefresh('https://mdstrm.com/video/abc.m3u8') === true, 'mdstrm: player URL sem vars precisa de refresh');
  ok(needsMdstrmRefresh('https://mdstrm.com/video/abc.m3u8?at=web-app&uid=x&sid=y&pid=z&av=v7.0.86') === false, 'mdstrm: player URL completa não precisa de refresh');
  const built = buildPlayerUrl('abc', { uid: 'u', sid: 's', pid: 'p', version: 'v7.0.86' });
  ok(built.includes('at=web-app') && built.includes('uid=u') && built.includes('sid=s') && built.includes('pid=p') && built.includes('av=v7.0.86'), `mdstrm: URL do player montada (${built})`);
}

// ---- setup comum ----
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// Faz backup do tools/ real (curl-impersonate v2.x instalado) para restaurar no fim.
const TOOLS_BACKUP = path.join(os.tmpdir(), 'vd-tools-backup');
const hadRealTools = fs.existsSync(path.join(TOOLS_DIR, 'curl-impersonate.exe'));
fs.rmSync(TOOLS_BACKUP, { recursive: true, force: true });
if (hadRealTools) fs.cpSync(TOOLS_DIR, TOOLS_BACKUP, { recursive: true });

// tools/ limpo + fake v1.x (cópia do curl.exe do Windows) para testar o fluxo.
fs.rmSync(TOOLS_DIR, { recursive: true, force: true });
fs.mkdirSync(TOOLS_DIR, { recursive: true });
fs.copyFileSync(
  path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'curl.exe'),
  path.join(TOOLS_DIR, 'curl_chrome999.exe')
);
console.log('Fake curl v1.x criado: tools\\curl_chrome999.exe (cópia do curl.exe do Windows)\n');

async function runCase({ label, encrypted, fmp4 }) {
  console.log(`\n================ CASO: ${label} ================\n`);

  fs.rmSync(E2E_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DIR, { recursive: true });

  // chave AES-128 (16 bytes) e arquivo keyinfo do FFmpeg
  // keyinfo: linha1 = caminho da chave (relativo ao CWD do ffmpeg = E2E_DIR),
  // linha2 = URI da chave na playlist, linha3 = IV **sem** prefixo 0x
  // (o FFmpeg adiciona o 0x sozinho — com 0x vira "0x0x..." e falha).
  let keyinfo = null;
  if (encrypted) {
    fs.writeFileSync(path.join(E2E_DIR, 'key.bin'), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
    fs.writeFileSync(
      path.join(E2E_DIR, 'keyinfo.txt'),
      ['key.bin', 'key.bin', '0102030405060708090a0b0c0d0e0f10', ''].join('\n')
    );
  }

  // gera o HLS com FFmpeg — tudo RELATIVO + cwd=E2E_DIR (senão o FFmpeg
  // escreve init.mp4 no CWD do processo e a playlist fica com caminho local).
  const segExt = fmp4 ? 'mp4' : 'ts';
  const args = [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60', '-c:a', 'aac',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
  ];
  if (fmp4) args.push('-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4');
  if (encrypted) args.push('-hls_key_info_file', 'keyinfo.txt');
  args.push('-hls_segment_filename', `seg%d.${segExt}`, 'media.m3u8');

  const gen = spawnSync('ffmpeg', args, { cwd: E2E_DIR, windowsHide: true });
  ok(gen.status === 0, `gerou HLS (${label}) com FFmpeg (exit ${gen.status})`);
  if (gen.status !== 0) {
    console.log(gen.stderr.toString().slice(-1500));
    return;
  }

  fs.writeFileSync(
    path.join(E2E_DIR, 'master.m3u8'),
    `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"
media.m3u8
`
  );

  if (encrypted) {
    const mediaText = fs.readFileSync(path.join(E2E_DIR, 'media.m3u8'), 'utf8');
    ok(mediaText.includes('#EXT-X-KEY:METHOD=AES-128'), 'playlist media gerada COM #EXT-X-KEY (AES-128)');
  }
  if (fmp4) {
    const mediaText = fs.readFileSync(path.join(E2E_DIR, 'media.m3u8'), 'utf8');
    ok(mediaText.includes('#EXT-X-MAP'), 'playlist media gerada COM #EXT-X-MAP (fMP4)');
  }

  // servidor HTTP local
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].replace(/^\//, ''));
    const file = path.join(E2E_DIR, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  // executa o programa em modo curl-impersonate (stdin via pipe)
  const stdin = `http://127.0.0.1:${port}/master.m3u8\ncurl-test\n${OUT_DIR}\n\n`;
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js'), '--curl-impersonate'], {
    cwd: ROOT,
    windowsHide: true,
  });
  child.stdin.end(stdin);

  let out = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));
  const code = await new Promise((resolve) => child.on('close', resolve));

  // resumo das linhas relevantes da saída
  for (const line of out.split(/\r?\n/)) {
    if (/URL reconhecida|Variant escolhida|Baixando segmentos|Segmentos baixados|Download concluído|ERRO|AVISO|falharam|modo:/i.test(line)) {
      console.log('  ' + line.trim());
    }
  }
  if (code !== 0) console.log(out.slice(-2000));

  // verificações
  ok(code === 0, `[${label}] exit code 0 (foi ${code})`);
  const mp4 = path.join(OUT_DIR, 'curl-test.mp4');
  const size = fs.existsSync(mp4) ? fs.statSync(mp4).size : 0;
  ok(size > 100000, `[${label}] MP4 gerado (${size} bytes)`);

  const r = spawnSync('ffmpeg', ['-i', mp4, '-f', 'null', '-'], { windowsHide: true });
  const stderr = r.stderr.toString();
  const dur = stderr.match(/Duration:\s*([0-9:.]+)/)?.[1];
  ok(/Duration:\s*00:00:0[4-9]/.test(stderr), `[${label}] MP4 válido (duration ${dur})`);

  // limpeza
  server.close();
  const leftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('vd-curl-'));
  ok(leftovers.length === 0, `[${label}] sem pastas vd-curl-* órfãs (${leftovers.length})`);
  fs.rmSync(path.join(OUT_DIR, 'curl-test.mp4'), { force: true });
}

async function runDirectCase() {
  console.log('\n================ CASO: arquivo direto MP4 ================\n');
  fs.rmSync(E2E_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DIR, { recursive: true });

  const mp4Source = path.join(E2E_DIR, 'source.mp4');
  const gen = spawnSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac',
    mp4Source,
  ], { windowsHide: true });
  ok(gen.status === 0, `gerou MP4 direto com FFmpeg (exit ${gen.status})`);
  if (gen.status !== 0) {
    console.log(gen.stderr.toString().slice(-1500));
    return;
  }

  const server = http.createServer((req, res) => {
    const file = path.join(E2E_DIR, decodeURIComponent(req.url.split('?')[0].replace(/^\//, '')));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      fs.createReadStream(file).pipe(res);
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const stdin = `http://127.0.0.1:${port}/source.mp4\ndirect-test\n${OUT_DIR}\n`;
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], { cwd: ROOT, windowsHide: true });
  child.stdin.end(stdin);

  let out = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));
  const code = await new Promise((resolve) => child.on('close', resolve));

  ok(code === 0, `[arquivo direto] exit code 0 (foi ${code})`);
  const mp4 = path.join(OUT_DIR, 'direct-test.mp4');
  const size = fs.existsSync(mp4) ? fs.statSync(mp4).size : 0;
  ok(size > 50000, `[arquivo direto] MP4 gerado (${size} bytes)`);
  server.close();
  fs.rmSync(mp4, { force: true });
}

async function runDashCase() {
  console.log('\n================ CASO: manifesto DASH (.mpd) ================\n');
  fs.rmSync(E2E_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DIR, { recursive: true });

  const gen = spawnSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac',
    '-f', 'dash',
    'manifest.mpd',
  ], { cwd: E2E_DIR, windowsHide: true });
  ok(gen.status === 0, `gerou DASH com FFmpeg (exit ${gen.status})`);
  if (gen.status !== 0) {
    console.log(gen.stderr.toString().slice(-1500));
    return;
  }

  const server = http.createServer((req, res) => {
    const file = path.join(E2E_DIR, decodeURIComponent(req.url.split('?')[0].replace(/^\//, '')));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': file.endsWith('.mpd') ? 'application/dash+xml' : 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const stdin = `http://127.0.0.1:${port}/manifest.mpd\ndash-test\n${OUT_DIR}\n`;
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], { cwd: ROOT, windowsHide: true });
  child.stdin.end(stdin);

  let out = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));
  const code = await new Promise((resolve) => child.on('close', resolve));

  ok(code === 0, `[DASH] exit code 0 (foi ${code})`);
  const mp4 = path.join(OUT_DIR, 'dash-test.mp4');
  const size = fs.existsSync(mp4) ? fs.statSync(mp4).size : 0;
  ok(size > 50000, `[DASH] MP4 gerado (${size} bytes)`);
  server.close();
  fs.rmSync(mp4, { force: true });
}

await runCase({ label: 'MPEG-TS criptografado (AES-128)', encrypted: true, fmp4: false });
await runCase({ label: 'fMP4 com EXT-X-MAP', encrypted: false, fmp4: true });
await runDirectCase();
await runDashCase();

// ---- teste unitário da detecção v2.x (curl-impersonate.exe + perfis .bat) ----
{
  // Simula a instalação v2.x: exe principal + wrapper .bat do perfil.
  const fakeExe = path.join(TOOLS_DIR, 'curl-impersonate.exe');
  const fakeBat = path.join(TOOLS_DIR, 'curl_chrome146.bat');
  fs.copyFileSync(
    path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'curl.exe'),
    fakeExe
  );
  fs.writeFileSync(fakeBat, '@echo off\r\n"%~dp0curl-impersonate.exe" --compressed --impersonate "chrome146" %*\r\n');
  const found = findCurlImpersonate();
  ok(!!found, `findCurlImpersonate: detectou v2.x (${found?.name})`);
  ok(found?.cmd?.endsWith('curl-impersonate.exe'), `findCurlImpersonate: cmd aponta para o exe principal (${found?.cmd})`);
  ok(found?.profile === 'chrome146', `findCurlImpersonate: perfil preferido = chrome146 (${found?.profile})`);
  fs.rmSync(fakeExe, { force: true });
  fs.rmSync(fakeBat, { force: true });
}

// ---- restaura o tools/ real (se havia backup) ----
fs.rmSync(TOOLS_DIR, { recursive: true, force: true });
if (hadRealTools) fs.cpSync(TOOLS_BACKUP, TOOLS_DIR, { recursive: true });
fs.rmSync(TOOLS_BACKUP, { recursive: true, force: true });
console.log(hadRealTools ? 'tools/ restaurado (curl-impersonate real preservado).' : 'tools/ vazio (sem instalação real).');

fs.rmSync(E2E_DIR, { recursive: true, force: true });
fs.rmSync(OUT_DIR, { recursive: true, force: true });

console.log(`\n${failures === 0 ? '✅ TODOS OS TESTES PASSARAM' : `❌ ${failures} TESTE(S) FALHARAM`}`);
process.exit(failures === 0 ? 0 : 1);
