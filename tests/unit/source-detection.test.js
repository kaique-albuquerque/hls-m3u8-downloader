import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { resolveSourceAdapter, resolveSourceAdapterAsync } from '../../src/source-adapters.js';

// ---- resolveSourceAdapter ----
test('source resolveSourceAdapter: mapeia por tipo de URL', () => {
  assert.equal(resolveSourceAdapter('https://www.youtube.com/watch?v=abc').id, 'youtube');
  assert.equal(resolveSourceAdapter('https://www.tiktok.com/@u/video/1').id, 'social');
  assert.equal(resolveSourceAdapter('https://cdn.example.com/index.m3u8').id, 'hls');
  assert.equal(resolveSourceAdapter('https://cdn.example.com/manifest.mpd').id, 'dash');
  assert.equal(resolveSourceAdapter('https://cdn.example.com/video.mp4').id, 'direct');
  assert.equal(resolveSourceAdapter('https://cdn.example.com/stream').id, 'unknown');
});

test('source resolveSourceAdapter: expoe analyze/prepareDownload', () => {
  const adapter = resolveSourceAdapter('https://cdn.example.com/index.m3u8');
  assert.equal(adapter.label, 'HLS (.m3u8)');
  assert.equal(adapter.supportsQualitySelection, true);
  assert.equal(typeof adapter.analyze, 'function');
  assert.equal(typeof adapter.prepareDownload, 'function');
});

// ---- resolveSourceAdapterAsync (servidor local) ----
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

test('source resolveSourceAdapterAsync: URL sem extensao com video/mp4 vira direct', async () => {
  const result = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4' });
    res.end('fake-mp4-bytes');
  }, async (base) => {
    const adapter = await resolveSourceAdapterAsync(`${base}/embed/stream`);
    assert.equal(adapter.id, 'direct');
    assert.equal(adapter.detectedContentType, 'video/mp4');
    return adapter;
  });
  assert.equal(result.id, 'direct');
});

test('source resolveSourceAdapterAsync: 404 permanece unknown', async () => {
  const result = await withServer((req, res) => {
    res.writeHead(404, 'Not Found');
    res.end();
  }, async (base) => {
    const adapter = await resolveSourceAdapterAsync(`${base}/embed/stream`);
    assert.equal(adapter.id, 'unknown');
    return adapter;
  });
  assert.equal(result.id, 'unknown');
});

test('source resolveSourceAdapterAsync: content-type texto permanece unknown', async () => {
  const result = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html></html>');
  }, async (base) => {
    const adapter = await resolveSourceAdapterAsync(`${base}/embed/stream`);
    assert.equal(adapter.id, 'unknown');
    return adapter;
  });
  assert.equal(result.id, 'unknown');
});
