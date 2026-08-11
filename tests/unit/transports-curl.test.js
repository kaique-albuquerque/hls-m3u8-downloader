// P4 — transports/curl: funcoes puras do transporte curl-impersonate.
//
// Cobre (plano §15/§16):
//  - extForUri: extensao segura para salvar segmentos/mapas
//  - rewritePlaylist: troca URLs remotas por arquivos locais
//    (segmentos, chaves URI="..." e mapas)
//  - resolve(): retorna null quando o binario curl-impersonate nao existe

import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';

import { extForUri, rewritePlaylist, CurlImpersonateTransport } from '../../src/transports/curl.js';

test('extForUri: extensao segura preservada', () => {
  assert.equal(extForUri('https://cdn/seg1.ts', 'ts'), 'ts');
  assert.equal(extForUri('https://cdn/seg.mp4?token=1', 'ts'), 'mp4');
  assert.equal(extForUri('https://cdn/init.m4s', 'mp4'), 'm4s');
});

test('extForUri: extensao insegura/ausente cai no fallback', () => {
  assert.equal(extForUri('https://cdn/seg', 'ts'), 'ts');
  assert.equal(extForUri('https://cdn/seg.php', 'ts'), 'ts');
  assert.equal(extForUri('https://cdn/seg.exe', 'mp4'), 'mp4');
  assert.equal(extForUri('https://cdn/seg.HTML', 'ts'), 'ts');
});

test('rewritePlaylist: segmentos trocados por arquivos locais', () => {
  const base = 'https://cdn.example/video/';
  const playlist = [
    '#EXTM3U',
    '#EXTINF:4.0,',
    'https://cdn.example/video/seg1.ts',
    '#EXTINF:4.0,',
    'seg2.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');

  const segMap = new Map([
    ['https://cdn.example/video/seg1.ts', path.join('tmp', 'seg_00000.ts')],
    ['https://cdn.example/video/seg2.ts', path.join('tmp', 'seg_00001.ts')],
  ]);

  const out = rewritePlaylist(playlist, segMap, new Map(), new Map(), base);
  assert.ok(out.includes('seg_00000.ts'), 'seg1 deve virar arquivo local');
  assert.ok(out.includes('seg_00001.ts'), 'seg2 (URI relativa) deve virar arquivo local');
  assert.ok(!out.includes('https://cdn.example'), 'nenhuma URL remota deve sobrar');
  assert.ok(out.includes('#EXTINF:4.0,'), 'tags devem ser preservadas');
});

test('rewritePlaylist: chaves e mapas (URI="...") trocados por locais', () => {
  const base = 'https://cdn.example/enc/';
  const playlist = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/enc/key.bin"',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:4.0,',
    'https://cdn.example/enc/seg1.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');

  const segMap = new Map([['https://cdn.example/enc/seg1.ts', path.join('tmp', 'seg_00000.ts')]]);
  const keyFiles = new Map([['https://cdn.example/enc/key.bin', path.join('tmp', 'key_0.bin')]]);
  const mapFiles = new Map([['https://cdn.example/enc/init.mp4', path.join('tmp', 'init_0.mp4')]]);

  const out = rewritePlaylist(playlist, segMap, keyFiles, mapFiles, base);
  assert.ok(out.includes('URI="key_0.bin"'), 'chave deve apontar para o arquivo local');
  assert.ok(out.includes('URI="init_0.mp4"'), 'map deve apontar para o arquivo local');
  assert.ok(out.includes('seg_00000.ts'), 'segmento deve apontar para o arquivo local');
  assert.ok(!out.includes('cdn.example'), 'nenhuma URL remota deve sobrar');
});

test('rewritePlaylist: URI desconhecida permanece intacta', () => {
  const playlist = ['#EXTM3U', '#EXTINF:4.0,', 'https://other.example/segX.ts', '#EXT-X-ENDLIST'].join('\n');
  const out = rewritePlaylist(playlist, new Map(), new Map(), new Map(), 'https://cdn.example/v/');
  assert.ok(out.includes('https://other.example/segX.ts'), 'URL fora do mapa deve ser mantida');
});

test('CurlImpersonateTransport.resolve: null quando nao ha binario (sem dependencia externa)', () => {
  // O binario curl-impersonate nao existe no ambiente de CI/testes, entao
  // resolve() deve retornar null — o fluxo CLI responde 'curl-ausente'.
  const t = CurlImpersonateTransport.resolve();
  assert.equal(t, null);
});
