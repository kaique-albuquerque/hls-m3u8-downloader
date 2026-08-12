// P11.1 — resolveFreshVariant: a variante escolhida na UI (selectedUrl) carrega
// tokens de sessão da análise do renderer, que podem expirar antes do engine
// rodar. O engine RE-analisa a URL do player e obtém um master com tokens
// frescos; o helper re-resolve a variante escolhida por PATHNAME (estável
// entre refreshes), nunca por query string (tokens nunca são comparáveis).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveFreshVariant } from '../../src/core/engine.js';

const STALE_URL =
  'https://us-b4-p-e-jn18.cdn.mdstrm.com/video/h/5e6f83ae335cdd1163e16b5b/6a0375bad35d4ea8b054c20b_6a0375bad35d4ea8b054c21d.mp4/index-v1-a1.m3u8?cP=1970000&pid=abc&sid=stale-sid&uid=stale-uid&access_token=stale-token&ote=1&ot=stale-ot';

const FRESH_URL =
  'https://us-b4-p-e-cg11.cdn.mdstrm.com/video/h/5e6f83ae335cdd1163e16b5b/6a0375bad35d4ea8b054c20b_6a0375bad35d4ea8b054c21d.mp4/index-v1-a1.m3u8?cP=1970000&pid=xyz&sid=fresh-sid&uid=fresh-uid&access_token=fresh-token&ote=2&ot=fresh-ot';

const FRESH_VARIANTS = [
  { uri: FRESH_URL, resolution: '1920x1080', bandwidth: 1970000 },
  {
    uri: 'https://us-b4-p-e-cg11.cdn.mdstrm.com/video/h/5e6f83ae335cdd1163e16b5b/6a0375bad35d4ea8b054c20b_6a0375bad35d4ea8b054c222.mp4/index-v1-a1.m3u8?cP=365000&access_token=fresh-token-2',
    resolution: '1280x720',
  },
];

test('resolveFreshVariant: re-resolve a variante por pathname com tokens frescos', () => {
  const fresh = resolveFreshVariant(STALE_URL, FRESH_VARIANTS);
  assert.equal(fresh, FRESH_URL, 'deve devolver a variante fresca com o mesmo pathname');
  assert.ok(!fresh.includes('stale-'), 'URL fresca não carrega tokens velhos');
  assert.ok(fresh.includes('access_token=fresh-token'), 'URL fresca carrega token novo');
});

test('resolveFreshVariant: ignora mudanca de hostname/query entre refreshes', () => {
  const selected =
    'https://us-other.cdn.mdstrm.com/video/h/a/1.mp4/index-v1-a1.m3u8?cP=1000000&access_token=whatever';
  const variants = [
    {
      uri: 'https://us-fresh.cdn.mdstrm.com/video/h/a/1.mp4/index-v1-a1.m3u8?cP=1000000&access_token=fresh-1',
    },
  ];
  assert.equal(resolveFreshVariant(selected, variants), variants[0].uri);
});

test('resolveFreshVariant: resolve URIs relativas contra baseUrl', () => {
  const base = 'https://mdstrm.com/video/abc.m3u8?at=web-app';
  const selected =
    'https://us-b4-p-e.cdn.mdstrm.com/video/h/a/1.mp4/index-v1-a1.m3u8?cP=1970000&access_token=old';
  const fresh = resolveFreshVariant(selected, [{ uri: '/video/h/a/1.mp4/index-v1-a1.m3u8?cP=1970000&access_token=new' }], base);
  assert.equal(
    fresh,
    'https://mdstrm.com/video/h/a/1.mp4/index-v1-a1.m3u8?cP=1970000&access_token=new'
  );
});

test('resolveFreshVariant: null quando nenhuma variante casa', () => {
  const selected =
    'https://us-b4-p-e.cdn.mdstrm.com/video/h/OUTRA-QUALIDADE.mp4/index-v1-a1.m3u8?access_token=old';
  assert.equal(resolveFreshVariant(selected, FRESH_VARIANTS), null);
});

test('resolveFreshVariant: null para selectedUrl invalida', () => {
  assert.equal(resolveFreshVariant('nao-e-uma-url', FRESH_VARIANTS), null);
  assert.equal(resolveFreshVariant('', FRESH_VARIANTS), null);
});

test('resolveFreshVariant: tolera variantes sem uri/url', () => {
  assert.equal(resolveFreshVariant(STALE_URL, [{}, { url: FRESH_URL }]), FRESH_URL);
});
