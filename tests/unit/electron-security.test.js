import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isSafeHttpUrl,
  isValidTaskId,
  sanitizeDownloadFilename,
  isAbsolutePath,
  isSafeAbsolutePath,
  validateAnalyzePayload,
  validateDownloadPayload,
  validateCancelPayload,
  validateRevealPayload,
  isPathWithin,
} from '../../electron/security.js';

// ---------------------------------------------------------------------------
// isSafeHttpUrl (URLs não confiáveis — seção 24)
// ---------------------------------------------------------------------------

test('isSafeHttpUrl aceita http/https', () => {
  assert.equal(isSafeHttpUrl('https://example.com/video.m3u8'), true);
  assert.equal(isSafeHttpUrl('http://example.com/stream'), true);
  assert.equal(isSafeHttpUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
});

test('isSafeHttpUrl rejeita protocolos perigosos e não-URLs', () => {
  assert.equal(isSafeHttpUrl('file:///etc/passwd'), false);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('data:text/html,<script>1</script>'), false);
  assert.equal(isSafeHttpUrl('ftp://example.com/file'), false);
  assert.equal(isSafeHttpUrl('gopher://example.com'), false);
  assert.equal(isSafeHttpUrl(''), false);
  assert.equal(isSafeHttpUrl('not a url'), false);
  assert.equal(isSafeHttpUrl('C:\\Windows\\system32'), false);
  assert.equal(isSafeHttpUrl('/etc/passwd'), false);
  assert.equal(isSafeHttpUrl(null), false);
  assert.equal(isSafeHttpUrl(undefined), false);
  assert.equal(isSafeHttpUrl(123), false);
});

// ---------------------------------------------------------------------------
// isValidTaskId
// ---------------------------------------------------------------------------

test('isValidTaskId aceita ids de aba restritos', () => {
  assert.equal(isValidTaskId('tab-1'), true);
  assert.equal(isValidTaskId('job_abc-123'), true);
  assert.equal(isValidTaskId('a'.repeat(64)), true);
});

test('isValidTaskId rejeita ids com caracteres especiais ou grandes demais', () => {
  assert.equal(isValidTaskId(''), false);
  assert.equal(isValidTaskId('tab-1; rm -rf /'), false);
  assert.equal(isValidTaskId('tab 1'), false);
  assert.equal(isValidTaskId('a'.repeat(65)), false);
  assert.equal(isValidTaskId('../../etc'), false);
  assert.equal(isValidTaskId(null), false);
  assert.equal(isValidTaskId(42), false);
});

// ---------------------------------------------------------------------------
// sanitizeDownloadFilename (path traversal / separadores — seção 24)
// ---------------------------------------------------------------------------

test('sanitizeDownloadFilename limpa caracteres inválidos', () => {
  assert.equal(sanitizeDownloadFilename('video'), 'video');
  assert.equal(sanitizeDownloadFilename('  meu vídeo  '), 'meu vídeo');
  assert.equal(sanitizeDownloadFilename('a:b?c'), 'a_b_c');
  assert.equal(sanitizeDownloadFilename('a*b|c'), 'a_b_c');
});

test('sanitizeDownloadFilename rejeita separadores e traversal', () => {
  assert.equal(sanitizeDownloadFilename(''), '');
  assert.equal(sanitizeDownloadFilename('   '), '');
  assert.equal(sanitizeDownloadFilename('..'), '');
  assert.equal(sanitizeDownloadFilename('../etc/passwd'), '');
  assert.equal(sanitizeDownloadFilename('..\\..\\win'), '');
  assert.equal(sanitizeDownloadFilename('a/b'), '');
  assert.equal(sanitizeDownloadFilename('a\\b'), '');
  assert.equal(sanitizeDownloadFilename(null), '');
  assert.equal(sanitizeDownloadFilename(undefined), '');
});

// ---------------------------------------------------------------------------
// isAbsolutePath / isSafeAbsolutePath (path traversal)
// ---------------------------------------------------------------------------

test('isAbsolutePath reconhece paths absolutos Windows e POSIX', () => {
  assert.equal(isAbsolutePath('C:\\Users\\teste\\Downloads'), true);
  assert.equal(isAbsolutePath('c:/Users/teste'), true);
  assert.equal(isAbsolutePath('/home/user/Downloads'), true);
  assert.equal(isAbsolutePath('relative/path'), false);
  assert.equal(isAbsolutePath('Downloads'), false);
  assert.equal(isAbsolutePath(''), false);
});

test('isSafeAbsolutePath rejeita segmentos ..', () => {
  assert.equal(isSafeAbsolutePath('C:\\Users\\teste\\Downloads'), true);
  assert.equal(isSafeAbsolutePath('/home/user'), true);
  assert.equal(isSafeAbsolutePath('C:\\Users\\..\\Windows'), false);
  assert.equal(isSafeAbsolutePath('/etc/../passwd'), false);
  assert.equal(isSafeAbsolutePath('relative'), false);
});

test('isPathWithin verifica subcaminhos', () => {
  assert.equal(isPathWithin('C:\\Users\\a\\Downloads\\v.mp4', 'C:\\Users\\a\\Downloads'), true);
  assert.equal(isPathWithin('C:\\Users\\a\\Downloads', 'C:\\Users\\a\\Downloads'), true);
  assert.equal(isPathWithin('C:\\Users\\a\\Other\\v.mp4', 'C:\\Users\\a\\Downloads'), false);
  assert.equal(isPathWithin('/home/a/v.mp4', '/home/a'), true);
  assert.equal(isPathWithin('/home/ab/v.mp4', '/home/a'), false);
});

// ---------------------------------------------------------------------------
// validateAnalyzePayload
// ---------------------------------------------------------------------------

test('validateAnalyzePayload aceita payload válido', () => {
  const out = validateAnalyzePayload({
    url: 'https://example.com/playlist.m3u8',
    headers: { 'user-agent': 'test' },
    auth: { cookiesFile: 'c:/cookies.txt' },
  });
  assert.ok(out);
  assert.equal(out.url, 'https://example.com/playlist.m3u8');
  assert.equal(out.headers['user-agent'], 'test');
  assert.equal(out.auth.cookiesFile, 'c:/cookies.txt');
});

test('validateAnalyzePayload rejeita URL inválida e normaliza campos ausentes', () => {
  assert.equal(validateAnalyzePayload({ url: 'javascript:alert(1)' }), null);
  assert.equal(validateAnalyzePayload({}), null);
  assert.equal(validateAnalyzePayload(null), null);
  const out = validateAnalyzePayload({ url: 'https://example.com' });
  assert.deepEqual(out.headers, {});
  assert.deepEqual(out.auth, { cookiesFile: '', cookiesFromBrowser: '' });
});

// ---------------------------------------------------------------------------
// validateDownloadPayload
// ---------------------------------------------------------------------------

test('validateDownloadPayload aceita payload de download válido', () => {
  const out = validateDownloadPayload({
    taskId: 'tab-1',
    url: 'https://example.com/video.mp4',
    filename: 'meu video',
    outputDir: 'C:\\Users\\teste\\Downloads',
    qualityChoice: '2',
    overwriteAction: 'rename',
    forceCurl: true,
    turbo: true,
  });
  assert.ok(out);
  assert.equal(out.taskId, 'tab-1');
  assert.equal(out.filename, 'meu video');
  assert.equal(out.qualityChoice, '2');
  assert.equal(out.overwriteAction, 'rename');
  assert.equal(out.forceCurl, true);
  assert.equal(out.turbo, true);
});

test('validateDownloadPayload rejeita payload inválido', () => {
  assert.equal(validateDownloadPayload({}), null);
  assert.equal(validateDownloadPayload({ taskId: 'tab-1' }), null); // sem URL
  assert.equal(
    validateDownloadPayload({ taskId: 'tab-1', url: 'https://example.com', filename: '../x' }),
    null
  );
  assert.equal(
    validateDownloadPayload({ taskId: 'tab-1', url: 'file:///etc', filename: 'video' }),
    null
  );
  assert.equal(
    validateDownloadPayload({
      taskId: 'tab-1',
      url: 'https://example.com',
      filename: 'video',
      outputDir: 'C:\\Users\\..\\Windows',
    }),
    null
  );
  assert.equal(
    validateDownloadPayload({
      taskId: 'tab-1',
      url: 'https://example.com',
      filename: 'video',
      qualityChoice: 'abc',
    }),
    null
  );
});

test('validateDownloadPayload normaliza defaults e força booleans', () => {
  const out = validateDownloadPayload({
    taskId: 'tab-2',
    url: 'https://example.com/v.m3u8',
    filename: 'video',
  });
  assert.ok(out);
  assert.equal(out.outputDir, '');
  assert.equal(out.qualityChoice, '');
  assert.equal(out.overwriteAction, 'overwrite');
  assert.equal(out.forceCurl, false);
  assert.equal(out.turbo, false);
  assert.equal(out.cookiesFile, '');
  assert.equal(out.cookiesFromBrowser, '');
});

// ---------------------------------------------------------------------------
// validateCancelPayload / validateRevealPayload
// ---------------------------------------------------------------------------

test('validateCancelPayload valida taskId', () => {
  assert.deepEqual(validateCancelPayload({ taskId: 'tab-1' }), { taskId: 'tab-1' });
  assert.equal(validateCancelPayload({ taskId: 'x; rm' }), null);
  assert.equal(validateCancelPayload({}), null);
});

test('validateRevealPayload restringe abertura a raízes permitidas', () => {
  const roots = ['C:\\Users\\teste\\Downloads', '/home/user'];
  assert.deepEqual(validateRevealPayload({ filePath: 'C:\\Users\\teste\\Downloads\\v.mp4' }, roots), {
    filePath: 'C:\\Users\\teste\\Downloads\\v.mp4',
  });
  assert.deepEqual(validateRevealPayload({ filePath: '/home/user/v.mp4' }, roots), {
    filePath: '/home/user/v.mp4',
  });
  assert.equal(validateRevealPayload({ filePath: 'C:\\Windows\\system32\\x.dll' }, roots), null);
  assert.equal(validateRevealPayload({ filePath: 'C:\\Users\\..\\etc' }, roots), null);
  assert.equal(validateRevealPayload({}, roots), null);
  assert.equal(validateRevealPayload({ filePath: 'relative.mp4' }, roots), null);
});
