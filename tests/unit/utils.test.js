import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  normalizeUrl,
  isValidM3u8Url,
  detectSourceType,
  isSupportedMediaUrl,
  isYouTubeUrl,
  isSocialMediaUrl,
  socialLabelForUrl,
  maskUrl,
  sanitizeFilename,
  ensureMp4,
  getDefaultDownloadsDir,
  formatBytes,
  formatKbps,
  normalizeHeaders,
  isDirectMediaContentType,
} from '../../src/utils.js';

// ---- normalizeUrl ----
test('utils normalizeUrl: link Markdown e extraido', () => {
  assert.equal(normalizeUrl('[Assista aqui](https://example.com/v.mp4)'), 'https://example.com/v.mp4');
});

test('utils normalizeUrl: remove aspas, colchetes e parenteses', () => {
  assert.equal(normalizeUrl('"https://example.com/v.mp4"'), 'https://example.com/v.mp4');
  assert.equal(normalizeUrl('(https://example.com/v.mp4)'), 'https://example.com/v.mp4');
  assert.equal(normalizeUrl('<https://example.com/v.mp4>'), 'https://example.com/v.mp4');
  assert.equal(normalizeUrl("'https://example.com/v.mp4'"), 'https://example.com/v.mp4');
});

test('utils normalizeUrl: desfaz escapes de markdown', () => {
  assert.equal(normalizeUrl('https://example.com/v\\.mp4\\?a\\=1'), 'https://example.com/v.mp4?a=1');
});

test('utils normalizeUrl: URL pura preservada, vazia retorna vazia', () => {
  assert.equal(normalizeUrl('https://example.com/v.mp4?x=1'), 'https://example.com/v.mp4?x=1');
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl('   '), '');
});

// ---- isValidM3u8Url ----
test('utils isValidM3u8Url: aceita .m3u8 e rejeita outros', () => {
  assert.equal(isValidM3u8Url('https://cdn.example.com/index.m3u8'), true);
  assert.equal(isValidM3u8Url('https://cdn.example.com/index.m3u8?token=1'), true);
  assert.equal(isValidM3u8Url('https://cdn.example.com/index.mp4'), false);
  assert.equal(isValidM3u8Url(''), false);
});

// ---- detectSourceType ----
test('utils detectSourceType: prioridade youtube > hls > dash > direct > social > unknown', () => {
  assert.equal(detectSourceType('https://www.youtube.com/watch?v=abc'), 'youtube');
  assert.equal(detectSourceType('https://cdn.example.com/index.m3u8'), 'hls');
  assert.equal(detectSourceType('https://cdn.example.com/manifest.mpd'), 'dash');
  assert.equal(detectSourceType('https://redirector.googlevideo.com/videoplayback?x=1'), 'direct');
  assert.equal(detectSourceType('https://www.tiktok.com/@user/video/123'), 'social');
  assert.equal(detectSourceType('https://cdn.example.com/video.mp4'), 'direct');
  assert.equal(detectSourceType('https://cdn.example.com/file.webm'), 'direct');
  assert.equal(detectSourceType('https://cdn.example.com/video.mkv'), 'direct');
  assert.equal(detectSourceType('https://cdn.example.com/video.mov'), 'direct');
  assert.equal(detectSourceType('https://cdn.example.com/video.m4v'), 'direct');
  assert.equal(detectSourceType('https://cdn.example.com/video.ts'), 'direct');
  assert.equal(detectSourceType('https://cdn.example.com/page'), 'unknown');
  assert.equal(detectSourceType('nao-e-uma-url'), 'unknown');
});

// ---- isSupportedMediaUrl / isYouTubeUrl / isSocialMediaUrl / socialLabelForUrl ----
test('utils isSupportedMediaUrl: aceita direto, hls, dash, youtube e social', () => {
  assert.equal(isSupportedMediaUrl('https://x.com/a.mp4'), true);
  assert.equal(isSupportedMediaUrl('https://x.com/a.m3u8'), true);
  assert.equal(isSupportedMediaUrl('https://x.com/a.mpd'), true);
  assert.equal(isSupportedMediaUrl('https://www.youtube.com/watch?v=1'), true);
  assert.equal(isSupportedMediaUrl('https://www.tiktok.com/@u/v/1'), true);
  // atencao: x.com e host social, entao .bin cai em "social" (true)
  assert.equal(isSupportedMediaUrl('https://x.com/a.bin'), true);
  assert.equal(isSupportedMediaUrl('https://example.com/a.bin'), false);
});

test('utils isYouTubeUrl: varias formas de host', () => {
  assert.equal(isYouTubeUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(isYouTubeUrl('https://youtube.com/watch?v=abc'), true);
  assert.equal(isYouTubeUrl('https://youtu.be/abc'), true);
  assert.equal(isYouTubeUrl('https://m.youtube.com/watch?v=abc'), true);
  assert.equal(isYouTubeUrl('https://example.com/watch?v=abc'), false);
});

test('utils isSocialMediaUrl e socialLabelForUrl: hosts conhecidos', () => {
  assert.equal(isSocialMediaUrl('https://www.tiktok.com/@user/video/1'), true);
  assert.equal(socialLabelForUrl('https://www.tiktok.com/@user/video/1'), 'TikTok');
  assert.equal(isSocialMediaUrl('https://www.instagram.com/p/abc/'), true);
  assert.equal(socialLabelForUrl('https://www.instagram.com/p/abc/'), 'Instagram');
  assert.equal(isSocialMediaUrl('https://example.com/tiktok'), false);
  // label de fallback para hosts nao sociais
  assert.equal(socialLabelForUrl('https://example.com/tiktok'), 'rede social');
});

// ---- maskUrl ----
test('utils maskUrl: mascara parametros sensiveis, preserva os demais', () => {
  const masked = maskUrl('https://example.com/v.mp4?token=abc&pid=123&sid=456&uid=789&cP=2063000&key=xyz');
  assert.ok(masked.includes('token=***'));
  assert.ok(masked.includes('sid=***'));
  assert.ok(masked.includes('uid=***'));
  assert.ok(masked.includes('key=***'));
  assert.ok(masked.includes('pid=123'), 'pid nao e sensivel');
  assert.ok(masked.includes('cP=2063000'), 'cP da Mídia Stream nao e sensivel');
  assert.ok(!masked.includes('token=abc'));
});

test('utils maskUrl: variantes de nomes sensiveis', () => {
  const masked = maskUrl('https://x.com/a?access_token=t&authorization=bearer&api_key=k&secret=s&password=p&jwt=j&signature=sig');
  assert.ok(masked.includes('access_token=***'));
  assert.ok(masked.includes('authorization=***'));
  assert.ok(masked.includes('api_key=***'));
  assert.ok(masked.includes('secret=***'));
  assert.ok(masked.includes('password=***'));
  assert.ok(masked.includes('jwt=***'));
  assert.ok(masked.includes('signature=***'));
});

test('utils maskUrl: URL sem query e valores nao-string', () => {
  assert.equal(maskUrl('https://example.com/v.mp4'), 'https://example.com/v.mp4');
  // comportamento atual (congelado): fallback retorna String(value)
  assert.equal(maskUrl(null), 'null');
  assert.equal(maskUrl(123), '123');
});

// ---- sanitizeFilename ----
test('utils sanitizeFilename: caracteres invalidos viram underscore', () => {
  assert.equal(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j'), 'a_b_c_d_e_f_g_h_i_j');
});

test('utils sanitizeFilename: remove pontos e espacos nas bordas', () => {
  assert.equal(sanitizeFilename('  video.mp4  '), 'video.mp4');
  assert.equal(sanitizeFilename('....video....'), 'video');
});

test('utils sanitizeFilename: nome vazio vira "video"', () => {
  assert.equal(sanitizeFilename(''), 'video');
  assert.equal(sanitizeFilename('   '), 'video');
  assert.equal(sanitizeFilename('...'), 'video');
});

test('utils sanitizeFilename: nomes reservados do Windows ganham prefixo _', () => {
  assert.equal(sanitizeFilename('CON'), '_CON');
  // quirk congelado: ao prefixar, o .mp4 e descartado (base sem extensao)
  assert.equal(sanitizeFilename('con.mp4'), '_con');
  assert.equal(sanitizeFilename('PRN'), '_PRN');
  assert.equal(sanitizeFilename('NUL'), '_NUL');
  assert.equal(sanitizeFilename('AUX'), '_AUX');
  assert.equal(sanitizeFilename('COM1'), '_COM1');
  assert.equal(sanitizeFilename('LPT9'), '_LPT9');
  assert.equal(sanitizeFilename('console'), 'console');
});

test('utils sanitizeFilename: unicode preservado', () => {
  assert.equal(sanitizeFilename('vídeo ção 日本語'), 'vídeo ção 日本語');
});

// ---- ensureMp4 ----
test('utils ensureMp4: adiciona .mp4 quando ausente', () => {
  assert.equal(ensureMp4('video'), 'video.mp4');
  assert.equal(ensureMp4('video.ts'), 'video.ts.mp4');
});

test('utils ensureMp4: preserva .mp4 existente (case-insensitive)', () => {
  assert.equal(ensureMp4('video.mp4'), 'video.mp4');
  assert.equal(ensureMp4('video.MP4'), 'video.MP4');
});

// ---- getDefaultDownloadsDir ----
test('utils getDefaultDownloadsDir: retorna diretorio existente', () => {
  const dir = getDefaultDownloadsDir();
  assert.equal(typeof dir, 'string');
  assert.ok(fs.existsSync(dir), `diretorio existe (${dir})`);
  assert.ok(path.isAbsolute(dir));
});

test('utils getDefaultDownloadsDir: prefere pasta Downloads quando existir', () => {
  const downloads = path.join(os.homedir(), 'Downloads');
  if (fs.existsSync(downloads)) {
    assert.equal(getDefaultDownloadsDir(), downloads);
  }
});

// ---- formatBytes ----
test('utils formatBytes: unidades e decimais', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(1024 * 1024 * 1024), '1.0 GB');
  assert.equal(formatBytes(1024 ** 4), '1.0 TB');
});

// ---- formatKbps ----
test('utils formatKbps: 0 vira vazio, Kbps e Mbps', () => {
  assert.equal(formatKbps(0), '');
  assert.equal(formatKbps(500000), '500 Kbps');
  assert.equal(formatKbps(999999), '1000 Kbps');
  assert.equal(formatKbps(1000000), '1.00 Mbps');
  assert.equal(formatKbps(1500000), '1.50 Mbps');
});

// ---- normalizeHeaders ----
test('utils normalizeHeaders: canonicaliza conhecidos, remove vazios, mantem demais', () => {
  const headers = normalizeHeaders({
    'user-agent': 'UA',
    referer: 'https://ref.example.com',
    origin: 'https://origin.example.com',
    cookie: '',
    'x-custom': 'v',
  });
  assert.deepEqual(headers, {
    'User-Agent': 'UA',
    Referer: 'https://ref.example.com',
    Origin: 'https://origin.example.com',
    // nao-canonicos sao mantidos com a chave original
    'x-custom': 'v',
  });
});

test('utils normalizeHeaders: objeto vazio e null', () => {
  assert.deepEqual(normalizeHeaders({}), {});
  assert.deepEqual(normalizeHeaders(null), {});
});

// ---- isDirectMediaContentType ----
test('utils isDirectMediaContentType: video/audio/application aceitos', () => {
  assert.equal(isDirectMediaContentType('video/mp4'), true);
  assert.equal(isDirectMediaContentType('audio/mpeg'), true);
  assert.equal(isDirectMediaContentType('application/mp4'), true);
  assert.equal(isDirectMediaContentType('application/octet-stream'), true);
  assert.equal(isDirectMediaContentType('text/html'), false);
  assert.equal(isDirectMediaContentType(''), false);
});
