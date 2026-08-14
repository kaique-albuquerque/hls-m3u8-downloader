import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLogger, redactText, redactHeaders, redact, LOG_LEVELS } from '../../src/core/logger.js';

function captureSink() {
  const lines = [];
  const sink = {
    debug: (...args) => lines.push(['debug', ...args]),
    info: (...args) => lines.push(['info', ...args]),
    warn: (...args) => lines.push(['warn', ...args]),
    error: (...args) => lines.push(['error', ...args]),
  };
  return { sink, lines };
}

test('core-logger: niveis existem (secao 27)', () => {
  assert.deepEqual(Object.keys(LOG_LEVELS).sort(), ['debug', 'error', 'info', 'warn']);
});

test('core-logger: redactText mascara URL assinada (token/access_token/sid)', () => {
  const out = redactText('baixando https://cdn.example.com/v.m3u8?cP=1997000&access_token=abc123&sid=xyz');
  assert.ok(out.includes('access_token=***'));
  assert.ok(out.includes('sid=***'));
  assert.ok(out.includes('cP=1997000'), 'parametro nao sensivel preservado');
  assert.ok(!out.includes('abc123'));
  assert.ok(!out.includes('xyz'));
});

test('core-logger: redactText redige Authorization inline', () => {
  const out = redactText('falha ao baixar. Authorization: Bearer eyJhbGciOiJIUzI1NiJ9');
  assert.ok(out.includes('Authorization:***'));
  assert.ok(!out.includes('eyJhbGci'));
});

test('core-logger: redactText redige Cookie inline (case-insensitive)', () => {
  const out = redactText('request com cookie: session=abc123');
  assert.ok(!out.includes('session=abc123'));
  assert.ok(out.includes('cookie:***'));
});

test('core-logger: redactText redige stderr de processo externo com URL + token', () => {
  const stderr = 'ffmpeg version 6.0\n[tcp @ ...] Connection failed: https://media.example/seg.ts?sig=deadbeef&token=abc\nAVERROR: Invalid data';
  const out = redactText(stderr);
  assert.ok(!out.includes('deadbeef'));
  assert.ok(!out.includes('abc'), 'token do stderr nao vaza');
  assert.ok(out.includes('sig=***'));
  assert.ok(out.includes('ffmpeg version 6.0'), 'restante do stderr preservado');
});

test('core-logger: redactHeaders redige authorization/cookie, preserva demais', () => {
  const headers = {
    'User-Agent': 'streamgrab/0.1.0',
    Referer: 'https://example.com',
    Authorization: 'Bearer abc123',
    Cookie: 'session=xyz',
  };
  const out = redactHeaders(headers);
  assert.equal(out['User-Agent'], 'streamgrab/0.1.0');
  assert.equal(out.Referer, 'https://example.com');
  assert.equal(out.Authorization, '***');
  assert.equal(out.Cookie, '***');
});

test('core-logger: redact recursivo em objetos (chaves sensiveis)', () => {
  const out = redact({ token: 't123', api_key: 'k456', headers: { Authorization: 'a' }, title: 'Aula', deep: { sid: 's9' } });
  assert.equal(out.token, '***');
  assert.equal(out.api_key, '***');
  assert.equal(out.headers.Authorization, '***');
  assert.equal(out.deep.sid, '***');
  assert.equal(out.title, 'Aula');
});

test('core-logger: redact preserva primitivos e arrays', () => {
  assert.equal(redact(42), 42);
  assert.equal(redact(true), true);
  assert.equal(redact(null), null);
  assert.deepEqual(redact(['https://x.com/v.mp4?sig=1', 'ok']), ['https://x.com/v.mp4?sig=***', 'ok']);
});

test('core-logger: filtro por nivel (debug suprimido no info)', () => {
  const { sink, lines } = captureSink();
  const logger = createLogger({ level: 'info', sink });
  logger.debug('debug invisivel https://x.com/v.mp4?token=a');
  logger.info('info visivel');
  logger.warn('warn visivel');
  logger.error('error visivel');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map(([lvl]) => lvl), ['info', 'warn', 'error']);
});

test('core-logger: nivel debug registra tudo', () => {
  const { sink, lines } = captureSink();
  const logger = createLogger({ level: 'debug', sink });
  logger.debug('d');
  logger.error('e');
  assert.equal(lines.length, 2);
});

test('core-logger: sink recebe valores ja redigidos', () => {
  const { sink, lines } = captureSink();
  const logger = createLogger({ level: 'info', sink });
  logger.info('URL: https://cdn.example.com/v.m3u8?access_token=segredo123');
  const msg = lines[0][1];
  assert.ok(msg.includes('access_token=***'));
  assert.ok(!msg.includes('segredo123'));
});

test('core-logger: error com objeto headers redigido', () => {
  const { sink, lines } = captureSink();
  const logger = createLogger({ level: 'info', sink });
  logger.error('falha', { headers: { Authorization: 'Bearer tok', Cookie: 'a=b' }, status: 403 });
  const obj = lines[0][2];
  assert.equal(obj.headers.Authorization, '***');
  assert.equal(obj.headers.Cookie, '***');
  assert.equal(obj.status, 403);
});

// Sprint 4.1: circular buffer for log export
test('core-logger: getBuffer returns log entries', () => {
  const { sink } = captureSink();
  const logger = createLogger({ level: 'debug', sink, bufferSize: 100 });
  logger.info('test message 1');
  logger.warn('test message 2');

  const buffer = logger.getBuffer();
  assert.equal(buffer.length, 2);
  assert.equal(buffer[0].level, 'info');
  assert.ok(buffer[0].message.includes('test message 1'));
  assert.equal(buffer[1].level, 'warn');
  assert.ok(buffer[1].message.includes('test message 2'));
  assert.ok(buffer[0].timestamp);
});

test('core-logger: buffer respects bufferSize limit', () => {
  const { sink } = captureSink();
  const logger = createLogger({ level: 'debug', sink, bufferSize: 3 });
  logger.info('msg 1');
  logger.info('msg 2');
  logger.info('msg 3');
  logger.info('msg 4');

  const buffer = logger.getBuffer();
  assert.equal(buffer.length, 3);
  assert.ok(buffer[0].message.includes('msg 2'), 'oldest entry shifted out');
});

test('core-logger: clearBuffer empties the buffer', () => {
  const { sink } = captureSink();
  const logger = createLogger({ level: 'debug', sink });
  logger.info('something');
  assert.equal(logger.getBuffer().length, 1);
  logger.clearBuffer();
  assert.equal(logger.getBuffer().length, 0);
});
