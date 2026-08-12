// Unit: provider HLS (P3) — detecção de DRM + analyze normalizado em MediaInfo.
// Sem rede externa: checkHlsDrm por texto; analyze com servidor HTTP local.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { hlsProvider } from '../../src/providers/hls/index.js';
import { checkHlsDrm } from '../../src/providers/hls/drm.js';
import { UnsupportedDrmError } from '../../src/core/errors.js';

// ---- checkHlsDrm ----
test('hls drm: playlists sem DRM passam', () => {
  assert.equal(checkHlsDrm('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nseg.ts\n'), false);
  assert.equal(checkHlsDrm('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\nseg.ts\n'), false);
  assert.equal(checkHlsDrm('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nv.m3u8\n'), false);
  assert.equal(checkHlsDrm(''), false);
});

test('hls drm: METHOD fora de NONE/AES-128 lanca UnsupportedDrmError', () => {
  assert.throws(
    () => checkHlsDrm('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key",IV=0x0\nseg.ts\n'),
    UnsupportedDrmError
  );
  assert.throws(
    () => checkHlsDrm('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="skd://x"\nseg.ts\n'),
    UnsupportedDrmError
  );
});

test('hls drm: EXT-X-SESSION-KEY com AES-128/identity passa (chave pre-declarada)', () => {
  // P11: a tag nao bloqueia mais por existir — criptografia segue AES-128,
  // que o fluxo atual suporta (o FFmpeg baixa a chave declarada).
  const masterAes = [
    '#EXTM3U',
    '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin",KEYFORMAT="identity"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360',
    '360p.m3u8',
    '',
  ].join('\n');
  assert.equal(checkHlsDrm(masterAes), false);

  const masterNoKeyformat = [
    '#EXTM3U',
    '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360',
    '360p.m3u8',
    '',
  ].join('\n');
  assert.equal(checkHlsDrm(masterNoKeyformat), false);
});

test('hls drm: EXT-X-SESSION-KEY com DRM real lanca UnsupportedDrmError', () => {
  // SAMPLE-AES no master (independe do KEYFORMAT).
  const masterSample = [
    '#EXTM3U',
    '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://license"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360',
    '360p.m3u8',
    '',
  ].join('\n');
  assert.throws(() => checkHlsDrm(masterSample), UnsupportedDrmError);

  // FairPlay: mesmo com METHOD=AES-128, o KEYFORMAT comercial e DRM.
  const masterFairPlay = [
    '#EXTM3U',
    '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="skd://license",KEYFORMAT="com.apple.streamingkeydelivery"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360',
    '360p.m3u8',
    '',
  ].join('\n');
  assert.throws(() => checkHlsDrm(masterFairPlay), UnsupportedDrmError);

  // Widevine e PlayReady tambem sao DRM (KEYFORMAT proprio).
  for (const keyformat of [
    'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed',
    'com.microsoft.playready',
  ]) {
    const master = [
      '#EXTM3U',
      `#EXT-X-SESSION-KEY:METHOD=AES-128,URI="skd://license",KEYFORMAT="${keyformat}"`,
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360',
      '360p.m3u8',
      '',
    ].join('\n');
    assert.throws(() => checkHlsDrm(master), UnsupportedDrmError);
  }
});

test('hls drm: EXT-X-KEY com KEYFORMAT FairPlay lanca mesmo com METHOD=AES-128', () => {
  // P11: KEYFORMAT analisado tambem nos #EXT-X-KEY (fMP4 FairPlay).
  assert.throws(
    () =>
      checkHlsDrm(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\nseg.ts\n'
      ),
    UnsupportedDrmError
  );
  // KEYFORMAT=identity e equivalente a ausente: permitido.
  assert.equal(
    checkHlsDrm('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin",KEYFORMAT="identity"\nseg.ts\n'),
    false
  );
});

test('hls drm: EXT-X-SESSION-KEY no master lanca UnsupportedDrmError', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://license",KEYFORMAT="com.apple.streamingkeydelivery"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360',
    '360p.m3u8',
    '',
  ].join('\n');
  assert.throws(() => checkHlsDrm(master), UnsupportedDrmError);
});

test('hls drm: erro carrega code UNSUPPORTED_DRM_ERROR', () => {
  try {
    checkHlsDrm('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\nseg.ts\n');
    assert.fail('deveria lancar');
  } catch (err) {
    assert.equal(err.code, 'UNSUPPORTED_DRM_ERROR');
    assert.match(err.message, /DRM/i);
  }
});

// ---- detect ----
test('hls provider: detect reconhece .m3u8 e mdstrm', () => {
  assert.equal(hlsProvider.detect('https://cdn.example.com/index.m3u8'), true);
  assert.equal(hlsProvider.detect('https://cdn.example.com/master.m3u8?token=abc'), true);
  assert.equal(hlsProvider.detect('https://cdn.mdstrm.com/video/abc.m3u8?at=web-app'), true);
  assert.equal(hlsProvider.detect('https://us-b4-p-e-123.cdn.mdstrm.com/live/xyz/index-v1-a1.m3u8'), true);
  // Embed (HTML) não é HLS direto — comportamento do utilitário legado preservado.
  assert.equal(hlsProvider.detect('https://mdstrm.com/embed/abc'), false);
  assert.equal(hlsProvider.detect('https://cdn.example.com/manifest.mpd'), false);
  assert.equal(hlsProvider.detect('https://cdn.example.com/video.mp4'), false);
});

// ---- analyze (servidor local) ----
function withServer(handler, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      fn(`http://127.0.0.1:${port}`)
        .then((result) => {
          server.close();
          resolve(result);
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

const MASTER_PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"',
  '720p.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360',
  '360p.m3u8',
  '',
].join('\n');

test('hls provider: analyze master -> MediaInfo normalizado', async () => {
  const result = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
    res.end(MASTER_PLAYLIST);
  }, async (base) => {
    const url = `${base}/master.m3u8`;
    const info = await hlsProvider.analyze({ url });
    assert.equal(info.kind, 'master');
    assert.equal(info.sourceType, 'hls');
    assert.equal(info.provider, 'hls');
    assert.equal(info.variants.length, 2);
    assert.equal(info.variants[0].height, 720);
    assert.equal(info.baseUrl, url);
    return info;
  });

  const formats = hlsProvider.getFormats(result);
  assert.equal(formats.length, 2);
  assert.equal(formats[0].formatId, 'hls-720');
  assert.equal(formats[0].url, '720p.m3u8');
  assert.equal(formats[0].height, 720);
  assert.equal(formats[0].hasVideo, true);
  assert.equal(formats[0].hasAudio, true);
});

test('hls provider: analyze media playlist -> kind media', async () => {
  const media = ['#EXTM3U', '#EXTINF:10,', 'seg0.ts', '#EXTINF:10,', 'seg1.ts', ''].join('\n');
  const result = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
    res.end(media);
  }, async (base) => hlsProvider.analyze({ url: `${base}/media.m3u8` }));
  assert.equal(result.kind, 'media');
  assert.equal(result.sourceType, 'hls');
});

test('hls provider: analyze com DRM lanca UnsupportedDrmError', async () => {
  const drmMedia = ['#EXTM3U', '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"', '#EXTINF:10,', 'seg0.ts', ''].join('\n');
  await assert.rejects(
    withServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end(drmMedia);
    }, async (base) => hlsProvider.analyze({ url: `${base}/drm.m3u8` })),
    UnsupportedDrmError
  );
});

test('hls provider: analyze HTTP 404 propaga erro com status', async () => {
  await assert.rejects(
    withServer((req, res) => {
      res.writeHead(404, 'Not Found');
      res.end();
    }, async (base) => hlsProvider.analyze({ url: `${base}/missing.m3u8` })),
    (err) => err.status === 404
  );
});

test('hls provider: prepareDownload devolve downloadUrl', async () => {
  const plan = await hlsProvider.prepareDownload({ url: 'https://cdn.example.com/index.m3u8' });
  assert.deepEqual(plan, { downloadUrl: 'https://cdn.example.com/index.m3u8' });
});
