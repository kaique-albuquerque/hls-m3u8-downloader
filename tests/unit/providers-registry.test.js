// Unit: ProviderRegistry (P3) — detecção por prioridade + probe de Content-Type.
// Sem rede externa: URLs por fixture; probe com servidor HTTP local.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { ProviderRegistry, createDefaultProviderRegistry } from '../../src/providers/registry.js';
import { ytdlpProvider } from '../../src/providers/ytdlp/index.js';

// ---- detecção por fixture ----
test('providers registry: detect retorna o provider correto por fixture', () => {
  const registry = createDefaultProviderRegistry();
  assert.equal(registry.detect('https://www.youtube.com/watch?v=abc').id, 'ytdlp');
  assert.equal(registry.detect('https://www.tiktok.com/@u/video/1').id, 'ytdlp');
  assert.equal(registry.detect('https://cdn.example.com/index.m3u8').id, 'hls');
  assert.equal(registry.detect('https://cdn.example.com/manifest.mpd').id, 'dash');
  assert.equal(registry.detect('https://cdn.example.com/video.mp4').id, 'direct');
  assert.equal(registry.detect('https://cdn.example.com/stream'), null);
});

test('providers registry: ytdlp com forceYouTube', () => {
  const registry = createDefaultProviderRegistry();
  assert.equal(
    registry.detect('https://www.youtube.com/watch?v=abc', { forceYouTube: true }).id,
    'ytdlp'
  );
  // forceYouTube não força URL não-YouTube para o provider ytdlp.
  assert.notEqual(registry.detect('https://cdn.example.com/video.mp4', { forceYouTube: true }).id, 'ytdlp');
});

test('providers registry: prioridade independe da ordem de registro', async () => {
  // Registro propositalmente fora de ordem — a prioridade decide a resolução.
  const { directProvider } = await import('../../src/providers/direct/index.js');
  const { dashProvider } = await import('../../src/providers/dash/index.js');
  const { hlsProvider } = await import('../../src/providers/hls/index.js');

  const registry = new ProviderRegistry()
    .register(directProvider)
    .register(dashProvider)
    .register(hlsProvider)
    .register(ytdlpProvider);

  assert.equal(registry.detect('https://www.youtube.com/watch?v=abc').id, 'ytdlp');
  assert.equal(registry.detect('https://cdn.example.com/index.m3u8').id, 'hls');
  assert.equal(registry.detect('https://cdn.example.com/manifest.mpd').id, 'dash');
  assert.equal(registry.detect('https://cdn.example.com/video.mp4').id, 'direct');
});

test('providers registry: provider duplicado lanca', () => {
  const registry = createDefaultProviderRegistry();
  assert.throws(() => registry.register(ytdlpProvider), /duplicado/i);
});

test('providers registry: get/list', () => {
  const registry = createDefaultProviderRegistry();
  assert.equal(registry.get('hls').id, 'hls');
  assert.equal(registry.get('nao-existe'), null);
  const ids = registry.list().map((p) => p.id).sort();
  assert.deepEqual(ids, ['dash', 'direct', 'hls', 'ytdlp']);
});

test('providers registry: detect nunca derruba com detector que lanca', () => {
  const registry = new ProviderRegistry();
  registry.register({
    id: 'quebrado',
    label: 'quebrado',
    priority: 200,
    detect() {
      throw new Error('boom');
    },
  });
  registry.register(ytdlpProvider);
  assert.equal(registry.detect('https://www.youtube.com/watch?v=abc').id, 'ytdlp');
});

// ---- probe por Content-Type (servidor local) ----
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

test('providers registry: detectAsync URL sem extensao com video/mp4 -> direct', async () => {
  const registry = createDefaultProviderRegistry();
  const result = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4' });
    res.end('fake-mp4-bytes');
  }, async (base) => {
    const { provider, detectedContentType } = await registry.detectAsync(`${base}/embed/stream`);
    assert.equal(provider.id, 'direct');
    assert.equal(detectedContentType, 'video/mp4');
    return provider;
  });
  assert.equal(result.id, 'direct');
});

test('providers registry: detectAsync 404 -> provider null', async () => {
  const registry = createDefaultProviderRegistry();
  const result = await withServer((req, res) => {
    res.writeHead(404, 'Not Found');
    res.end();
  }, async (base) => registry.detectAsync(`${base}/embed/stream`));
  assert.equal(result.provider, null);
});

test('providers registry: detectAsync URL hls nao faz probe', async () => {
  const registry = createDefaultProviderRegistry();
  const result = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html></html>');
  }, async (base) => registry.detectAsync(`${base}/index.m3u8`));
  assert.equal(result.provider.id, 'hls');
  assert.equal(result.detectedContentType, '');
});
