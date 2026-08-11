import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maskUrl } from '../../src/utils.js';

/**
 * Testes de redaction (P0): congelam o comportamento de maskUrl(),
 * a unica redacao implementada hoje. P2.2 centralizara a redacao no
 * logger do core e reutilizara maskUrl — estes testes servirao de rede
 * de seguranca para essa mudanca.
 *
 * Lista congelada de parametros sensiveis (regex case-insensitive):
 * token, access_token, authorization, auth, sid, uid, signature, sig,
 * key, api_key, apikey, api-key, secret, password, pass, pwd, session,
 * session_id, jwt.
 */

const SENSITIVE = [
  'token',
  'access_token',
  'authorization',
  'auth',
  'sid',
  'uid',
  'signature',
  'sig',
  'key',
  'api_key',
  'apikey',
  'api-key',
  'secret',
  'password',
  'pass',
  'pwd',
  'session',
  'session_id',
  'jwt',
];

const NOT_SENSITIVE = ['pid', 'cP', 'id', 'videoId', 'itag', 'range', 't', 'e', 'at', 'av', 'version', 'title'];

test('redaction maskUrl: todos os parametros sensiveis congelados sao mascarados', () => {
  const params = SENSITIVE.map((name) => `${name}=segredo`).join('&');
  const masked = maskUrl(`https://example.com/v.mp4?${params}`);
  for (const name of SENSITIVE) {
    assert.ok(masked.includes(`${name}=***`), `${name} mascarado`);
    assert.ok(!masked.includes(`${name}=segredo`), `${name} sem vazamento`);
  }
});

test('redaction maskUrl: parametros nao sensiveis preservados', () => {
  const params = NOT_SENSITIVE.map((name) => `${name}=valor`).join('&');
  const masked = maskUrl(`https://example.com/v.mp4?${params}`);
  for (const name of NOT_SENSITIVE) {
    assert.ok(masked.includes(`${name}=valor`), `${name} preservado`);
  }
});

test('redaction maskUrl: sensivel e case-insensitive', () => {
  const masked = maskUrl('https://example.com/v.mp4?TOKEN=abc&Signature=xyz');
  assert.ok(masked.includes('TOKEN=***'));
  assert.ok(masked.includes('Signature=***'));
});

test('redaction maskUrl: URL de HLS real do mdstrm mantem cP e pid mas mascara uid/sid', () => {
  const url =
    'https://us-b4-p-e-qg12.cdn.mdstrm.com/video/h/5e6f83ae335cdd1163e16b5b/6a03573096d73ba91827573a_6a03573096d73ba91827574b.mp4/index-v1-a1.m3u8?cP=2063000&pid=abc&sid=def&uid=ghi';
  const masked = maskUrl(url);
  assert.ok(masked.includes('cP=2063000'), 'cP preservado');
  assert.ok(masked.includes('pid=abc'), 'pid preservado');
  assert.ok(masked.includes('sid=***'), 'sid mascarado');
  assert.ok(masked.includes('uid=***'), 'uid mascarado');
  assert.ok(!masked.includes('sid=def'));
  assert.ok(!masked.includes('uid=ghi'));
});

test('redaction maskUrl: query vazia e URL simples preservadas', () => {
  assert.equal(maskUrl('https://example.com/v.mp4'), 'https://example.com/v.mp4');
  // comportamento atual (congelado): o ? final e mantido por URL.toString()
  assert.equal(maskUrl('https://example.com/v.mp4?'), 'https://example.com/v.mp4?');
});

test('redaction maskUrl: valores vazios tambem sao mascarados', () => {
  const masked = maskUrl('https://example.com/v.mp4?token=&key=');
  assert.ok(masked.includes('token=***'));
  assert.ok(masked.includes('key=***'));
});

test('redaction maskUrl: nao lancou excecao para entradas invalidas', () => {
  assert.equal(maskUrl(''), '');
  assert.equal(maskUrl(undefined), 'undefined');
});
