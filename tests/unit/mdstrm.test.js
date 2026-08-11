import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isMdstrmUrl, extractMdstrmVideoId, needsMdstrmRefresh, buildPlayerUrl } from '../../src/mdstrm.js';

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
