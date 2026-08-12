import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isMdstrmUrl, extractMdstrmVideoId, needsMdstrmRefresh, buildPlayerUrl, refreshMdstrmUrl } from '../../src/mdstrm.js';

const CDN_URL =
  'https://us-b4-p-e-qg12.cdn.mdstrm.com/video/h/5e6f83ae335cdd1163e16b5b/6a03573096d73ba91827573a_6a03573096d73ba91827574b.mp4/index-v1-a1.m3u8?cP=2063000&pid=abc&sid=def&uid=ghi';
const PLAYER_URL = 'https://mdstrm.com/video/6a03573096d73ba91827573a.m3u8?at=web-app&uid=x&sid=y&pid=z&av=v7.0.86';
const EMBED_URL = 'https://mdstrm.com/embed/6a03573096d73ba91827573a';

// ---- isMdstrmUrl ----
test('mdstrm isMdstrmUrl: so URLs com .mdstrm.com/ (ou inicio) casam', () => {
  // comportamento atual (congelado): a regex exige . ou inicio antes de mdstrm,
  // entao URLs do player/embed (https://mdstrm.com/...) NAO casam
  assert.equal(isMdstrmUrl(CDN_URL), true);
  assert.equal(isMdstrmUrl(PLAYER_URL), false);
  assert.equal(isMdstrmUrl(EMBED_URL), false);
  assert.equal(isMdstrmUrl('https://example.com/video/abc.m3u8'), false);
  assert.equal(isMdstrmUrl(''), false);
});

// ---- extractMdstrmVideoId ----
test('mdstrm extractMdstrmVideoId: extrai das tres formas de URL', () => {
  assert.equal(extractMdstrmVideoId(CDN_URL), '6a03573096d73ba91827573a');
  assert.equal(extractMdstrmVideoId(PLAYER_URL), '6a03573096d73ba91827573a');
  assert.equal(extractMdstrmVideoId(EMBED_URL), '6a03573096d73ba91827573a');
  assert.equal(extractMdstrmVideoId('https://example.com/x.m3u8'), null);
});

// ---- needsMdstrmRefresh ----
test('mdstrm needsMdstrmRefresh: CDN cru e player incompleto precisam, player completo nao', () => {
  assert.equal(needsMdstrmRefresh(CDN_URL), true, 'URL crua do CDN precisa de refresh');
  assert.equal(needsMdstrmRefresh('https://mdstrm.com/video/abc.m3u8'), true, 'player sem vars precisa');
  assert.equal(needsMdstrmRefresh(PLAYER_URL), false, 'player completo nao precisa');
  assert.equal(needsMdstrmRefresh('https://example.com/x.m3u8'), false);
});

// ---- buildPlayerUrl ----
test('mdstrm buildPlayerUrl: monta URL do player com variaveis', () => {
  const url = buildPlayerUrl('abc', { uid: 'u', sid: 's', pid: 'p', version: 'v7.0.86' });
  assert.ok(url.startsWith('https://mdstrm.com/video/abc.m3u8?'));
  assert.ok(url.includes('at=web-app'));
  assert.ok(url.includes('uid=u'));
  assert.ok(url.includes('sid=s'));
  assert.ok(url.includes('pid=p'));
  assert.ok(url.includes('av=v7.0.86'));
});

// ---- refreshMdstrmUrl ----
test('mdstrm refreshMdstrmUrl: converte CDN cru usando client getText', async () => {
  const fakeClient = {
    getText: async (embedUrl) => {
      assert.equal(embedUrl, EMBED_URL, 'client deve buscar o embed publico');
      return {
        text:
          'window.MDSTRMUID="u";window.MDSTRMSID="s";window.MDSTRMPID="p";window.VERSION="v9";',
      };
    },
  };
  const refreshed = await refreshMdstrmUrl(CDN_URL, fakeClient);
  assert.ok(refreshed.startsWith('https://mdstrm.com/video/6a03573096d73ba91827573a.m3u8?'), `URL do player (${refreshed})`);
  assert.ok(refreshed.includes('uid=u') && refreshed.includes('sid=s') && refreshed.includes('pid=p') && refreshed.includes('av=v9'), `vars aplicadas (${refreshed})`);
});

test('mdstrm refreshMdstrmUrl: usa fetch nativo quando client ausente', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (embedUrl) => {
    assert.equal(embedUrl, EMBED_URL, 'fetch nativo deve buscar o embed publico');
    return {
      ok: true,
      status: 200,
      text: async () => 'window.MDSTRMUID="u2";window.MDSTRMSID="s2";window.MDSTRMPID="p2";window.VERSION="v10";',
    };
  };
  try {
    const refreshed = await refreshMdstrmUrl(CDN_URL);
    assert.ok(refreshed.includes('uid=u2') && refreshed.includes('av=v10'), `vars aplicadas via fetch (${refreshed})`);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('mdstrm refreshMdstrmUrl: player completo e URL de outra plataforma ficam como estao', async () => {
  assert.equal(await refreshMdstrmUrl(PLAYER_URL), PLAYER_URL, 'player completo nao muda');
  assert.equal(await refreshMdstrmUrl('https://example.com/x.m3u8'), 'https://example.com/x.m3u8', 'URL estranha nao muda');
});

test('mdstrm refreshMdstrmUrl: lanca quando o embed nao expoe as variaveis', async () => {
  const fakeClient = {
    getText: async () => ({ text: '<html>sem variaveis</html>' }),
  };
  await assert.rejects(() => refreshMdstrmUrl(CDN_URL, fakeClient), /vari[áa]veis do player/);
});
