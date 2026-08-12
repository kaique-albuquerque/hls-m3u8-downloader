import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

import {
  parseAttributes,
  parsePlaylistText,
  parseSegmentPlaylist,
  fetchPlaylist,
  fetchPlaylistText,
} from '../../src/hls.js';
import { DEFAULT_USER_AGENT } from '../../src/utils.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'hls');

function fixture(name) {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

// ---- parseAttributes ----
test('hls parseAttributes: valores com virgula dentro de aspas sao preservados', () => {
  const attrs = parseAttributes('BANDWIDTH=900000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"');
  assert.equal(attrs.BANDWIDTH, '900000');
  assert.equal(attrs.RESOLUTION, '1280x720');
  assert.equal(attrs.CODECS, 'avc1.640028,mp4a.40.2');
});

test('hls parseAttributes: valores sem aspas e IV com 0x', () => {
  const attrs = parseAttributes('METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001');
  assert.equal(attrs.METHOD, 'AES-128');
  assert.equal(attrs.URI, 'key.bin');
  assert.equal(attrs.IV, '0x00000000000000000000000000000001');
});

test('hls parseAttributes: string vazia retorna objeto vazio', () => {
  assert.deepEqual(parseAttributes(''), {});
});

// ---- parsePlaylistText ----
test('hls parsePlaylistText: master deduplica por uri e ordena altura desc, bandwidth desc', () => {
  const parsed = parsePlaylistText(fixture('master.m3u8'), 'https://cdn.example.com/hls/');
  assert.equal(parsed.kind, 'master');
  assert.equal(parsed.variants.length, 2);
  assert.equal(parsed.variants[0].uri, '../v7/media.m3u8');
  assert.equal(parsed.variants[0].resolution, '1280x720');
  assert.equal(parsed.variants[0].width, 1280);
  assert.equal(parsed.variants[0].height, 720);
  assert.equal(parsed.variants[0].bandwidth, 900000);
  assert.equal(parsed.variants[0].codecs, 'avc1.640028,mp4a.40.2');
  assert.equal(parsed.variants[1].height, 360);
  assert.equal(parsed.variants[1].bandwidth, 500000);
});

test('hls parsePlaylistText: media -> kind media', () => {
  const parsed = parsePlaylistText(fixture('media.m3u8'), 'https://cdn.example.com/hls/');
  assert.equal(parsed.kind, 'media');
});

test('hls parsePlaylistText: texto sem marcadores -> kind unknown', () => {
  const parsed = parsePlaylistText('ola mundo', 'https://cdn.example.com/');
  assert.equal(parsed.kind, 'unknown');
});

// ---- parseSegmentPlaylist ----
test('hls parseSegmentPlaylist: segmentos, duracao total e fim de lista', () => {
  const parsed = parseSegmentPlaylist(fixture('media.m3u8'));
  assert.equal(parsed.segments.length, 3);
  assert.deepEqual(parsed.segments.map((s) => s.uri), ['seg0.ts', 'seg1.ts', 'seg2.ts']);
  assert.equal(parsed.targetDuration, 6);
  assert.ok(Math.abs(parsed.totalDuration - (6.006 + 6.006 + 4.004)) < 1e-6);
  assert.equal(parsed.segments[0].key, null);
});

test('hls parseSegmentPlaylist: AES-128 propaga key e METHOD=NONE limpa', () => {
  const parsed = parseSegmentPlaylist(fixture('aes-media.m3u8'));
  assert.equal(parsed.keys.length, 1);
  assert.equal(parsed.keys[0].uri, 'key.bin?token=abc');
  assert.equal(parsed.keys[0].iv, '0x00000000000000000000000000000001');
  assert.equal(parsed.keys[0].method, 'AES-128');
  assert.equal(parsed.segments[0].key.uri, 'key.bin?token=abc');
  assert.equal(parsed.segments[1].key.uri, 'key.bin?token=abc');
  assert.equal(parsed.segments[2].key, null, 'METHOD=NONE limpa a chave');
});

test('hls parseSegmentPlaylist: EXT-X-MAP unico por uri', () => {
  const parsed = parseSegmentPlaylist(fixture('fmp4-media.m3u8'));
  assert.equal(parsed.maps.length, 1);
  assert.equal(parsed.maps[0].uri, 'init.mp4');
  // comportamento atual: o map NAO e propagado para cada segmento
  assert.equal(parsed.segments[0].map, undefined);
});

test('hls parseSegmentPlaylist: BYTERANGE ignorado, segmentos contados', () => {
  const parsed = parseSegmentPlaylist(fixture('byterange-media.m3u8'));
  assert.equal(parsed.segments.length, 2);
  assert.deepEqual(parsed.segments.map((s) => s.uri), ['main.mp4', 'main.mp4']);
  assert.ok(Math.abs(parsed.totalDuration - 20) < 1e-6);
});

// ---- fetchPlaylist (servidor local) ----
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

test('hls fetchPlaylist: master via HTTP com baseUrl final', async () => {
  const result = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
    res.end(fixture('master.m3u8'));
  }, async (base) => {
    const parsed = await fetchPlaylist(`${base}/index.m3u8`);
    assert.equal(parsed.kind, 'master');
    // baseUrl e a URL completa da playlist (nao apenas o diretorio)
    assert.equal(parsed.baseUrl, `${base}/index.m3u8`);
    assert.equal(parsed.variants.length, 2);
    return parsed;
  });
  assert.equal(result.kind, 'master');
});

test('hls fetchPlaylist: 404 lanca Error com status', async () => {
  await assert.rejects(
    withServer((req, res) => {
      res.writeHead(404, 'Not Found');
      res.end('nope');
    }, async (base) => fetchPlaylist(`${base}/missing.m3u8`)),
    (err) => {
      assert.equal(err.status, 404);
      assert.match(err.message, /HTTP 404/);
      return true;
    }
  );
});

test('hls fetchPlaylistText: envia User-Agent padrao (403 de CDN sem UA nao acontece)', async () => {
  let seenUA = null;
  await withServer((req, res) => {
    seenUA = req.headers['user-agent'];
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
    res.end(fixture('media.m3u8'));
  }, async (base) => {
    await fetchPlaylistText(`${base}/media.m3u8`);
    assert.equal(seenUA, DEFAULT_USER_AGENT, 'UA padrao presente no request');

    // Header do usuario vence o default.
    const custom = 'MyCustomUA/1.0';
    await fetchPlaylistText(`${base}/media.m3u8`, { 'User-Agent': custom });
    assert.equal(seenUA, custom, 'UA customizado vence o default');
  });
});
