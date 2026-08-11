import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  StreamGrabError,
  UnsupportedSourceError,
  NetworkError,
  AuthenticationError,
  ForbiddenError,
  RateLimitError,
  ExpiredUrlError,
  MediaNotFoundError,
  FFmpegError,
  YtDlpError,
  DiskSpaceError,
  PermissionError,
  UnsupportedDrmError,
  CancelledError,
  isStreamGrabError,
  isRetryable,
  classifyError,
} from '../../src/core/errors.js';

test('core-errors: todas as classes existem e herdam StreamGrabError/Error', () => {
  const classes = [
    StreamGrabError,
    UnsupportedSourceError,
    NetworkError,
    AuthenticationError,
    ForbiddenError,
    RateLimitError,
    ExpiredUrlError,
    MediaNotFoundError,
    FFmpegError,
    YtDlpError,
    DiskSpaceError,
    PermissionError,
    UnsupportedDrmError,
    CancelledError,
  ];
  for (const Cls of classes) {
    const err = new Cls();
    assert.ok(err instanceof Error, `${Cls.name} instanceof Error`);
    assert.ok(err instanceof StreamGrabError, `${Cls.name} instanceof StreamGrabError`);
    assert.equal(isStreamGrabError(err), true);
  }
});

test('core-errors: defaults de retryability por classe', () => {
  assert.equal(new NetworkError().retryable, true);
  assert.equal(new RateLimitError().retryable, true);
  assert.equal(new AuthenticationError().retryable, false);
  assert.equal(new ForbiddenError().retryable, false);
  assert.equal(new UnsupportedDrmError().retryable, false);
  assert.equal(new CancelledError().retryable, false);
  assert.equal(new StreamGrabError('x').retryable, false);
});

test('core-errors: classe + mensagem amigavel + detalhe tecnico + code/status', () => {
  const err = new ForbiddenError('Acesso negado pelo servidor.', {
    detail: 'status=403, body=<html>...',
    status: 403,
  });
  assert.equal(err.name, 'ForbiddenError');
  assert.equal(err.message, 'Acesso negado pelo servidor.');
  assert.equal(err.friendlyMessage, 'Acesso negado pelo servidor.');
  assert.equal(err.detail, 'status=403, body=<html>...');
  assert.equal(err.code, 'FORBIDDEN_ERROR');
  assert.equal(err.status, 403);
  assert.equal(err.retryable, false);
});

test('core-errors: mensagens amigaveis default', () => {
  assert.equal(new UnsupportedSourceError().message, 'Fonte nao suportada.');
  assert.equal(new AuthenticationError().message, 'Conteudo exige autenticacao (login).');
  assert.equal(new MediaNotFoundError().message, 'Midia nao encontrada (404).');
  assert.equal(new DiskSpaceError().message, 'Espaco em disco insuficiente.');
  assert.equal(new CancelledError().message, 'Operacao cancelada pelo usuario.');
});

test('core-errors: toJSON tem shape plano (sem funcoes/circular)', () => {
  const err = new YtDlpError('Falha no yt-dlp.', { detail: 'stderr', retryable: false, status: 0 });
  const json = JSON.stringify(err.toJSON());
  const parsed = JSON.parse(json);
  assert.equal(parsed.name, 'YtDlpError');
  assert.equal(parsed.message, 'Falha no yt-dlp.');
  assert.equal(parsed.code, 'YTDLP_ERROR');
  assert.equal(parsed.detail, 'stderr');
  assert.equal(parsed.retryable, false);
  assert.equal(parsed.status, 0);
  assert.ok(!json.includes('function'));
});

test('core-errors: classifyError 401/403/404/429/5xx', () => {
  assert.ok(classifyError(Object.assign(new Error('unauthorized'), { status: 401 })) instanceof AuthenticationError);
  assert.ok(classifyError(Object.assign(new Error('forbidden'), { status: 403 })) instanceof ForbiddenError);
  assert.ok(classifyError(Object.assign(new Error('missing'), { status: 404 })) instanceof MediaNotFoundError);
  const rate = classifyError(Object.assign(new Error('too many'), { status: 429 }));
  assert.ok(rate instanceof RateLimitError);
  assert.equal(rate.retryable, true);
  const server = classifyError(Object.assign(new Error('boom'), { status: 503 }));
  assert.ok(server instanceof NetworkError);
  assert.equal(server.retryable, true);
});

test('core-errors: classifyError codigos de rede do Node sao retryable', () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE']) {
    const err = classifyError(Object.assign(new Error(code), { code }));
    assert.ok(err instanceof NetworkError, `${code} -> NetworkError`);
    assert.equal(err.retryable, true, `${code} retryable`);
  }
});

test('core-errors: classifyError ENOSPC/EACCES/EPERM', () => {
  assert.ok(classifyError(Object.assign(new Error('no space'), { code: 'ENOSPC' })) instanceof DiskSpaceError);
  assert.ok(classifyError(Object.assign(new Error('denied'), { code: 'EACCES' })) instanceof PermissionError);
  assert.ok(classifyError(Object.assign(new Error('denied'), { code: 'EPERM' })) instanceof PermissionError);
});

test('core-errors: classifyError codigos dos adapters', () => {
  assert.ok(classifyError(Object.assign(new Error('x'), { code: 'UNSUPPORTED_SOURCE' })) instanceof UnsupportedSourceError);
  assert.ok(classifyError(Object.assign(new Error('x'), { code: 'FFMPEG_ERROR' })) instanceof FFmpegError);
  assert.ok(classifyError(Object.assign(new Error('x'), { code: 'CANCELLED' })) instanceof CancelledError);

  const auth = classifyError(Object.assign(new Error('restrito'), { code: 'YTDLP_ANALYZE_FAILED', needsAuth: true }));
  assert.ok(auth instanceof AuthenticationError);
  assert.equal(auth.retryable, false);

  const ytdlp = classifyError(Object.assign(new Error('sem formatos'), { code: 'YTDLP_ANALYZE_FAILED', needsAuth: false }));
  assert.ok(ytdlp instanceof YtDlpError);
  assert.ok(classifyError(Object.assign(new Error('sem formatos'), { code: 'YTDLP_FORMAT_UNAVAILABLE' })) instanceof YtDlpError);
});

test('core-errors: classifyError mantem detalhe tecnico e causa', () => {
  const cause = Object.assign(new Error('reset'), { code: 'ECONNRESET', stderr: 'curl: (56) connection reset' });
  const err = classifyError(cause);
  assert.ok(err instanceof NetworkError);
  assert.equal(err.detail, 'curl: (56) connection reset');
  assert.equal(err.cause, cause);
});

test('core-errors: classifyError ja-classificado passa direto', () => {
  const original = new UnsupportedDrmError('DRM nao suportado.');
  assert.equal(classifyError(original), original);
  assert.equal(isRetryable(original), false);
});

test('core-errors: classifyError fallback generico nao retryable', () => {
  const err = classifyError(new Error('algo deu errado'));
  assert.ok(err instanceof StreamGrabError);
  assert.equal(err.code, 'STREAMGRAB_ERROR');
  assert.equal(err.retryable, false);
});

test('core-errors: isRetryable so respeita taxonomia', () => {
  assert.equal(isRetryable(new NetworkError()), true);
  assert.equal(isRetryable(new AuthenticationError()), false);
  assert.equal(isRetryable(new Error('qualquer')), false);
});
