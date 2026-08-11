// P4 — core/strategy: selecao de transporte + fallback por classe de erro.
//
// Cobre (plano §16/§41):
//  - selectStrategy para mux/ffmpeg(hls,dash)/ytdlp/http/range
//  - fallback range -> http sequencial quando servidor nao tem Range
//  - 403 NUNCA dispara loop de transports (terminal -> stop)
//  - erros retryable (Network/429/5xx) -> retry na MESMA estrategia
//  - erros terminais (401/DRM/URL expirada/not-media/disco/permissao) -> stop

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  STRATEGIES,
  selectStrategy,
  resolveFallback,
  canFallback,
  isTerminalError,
} from '../../src/core/strategy.js';
import {
  NetworkError,
  RateLimitError,
  ForbiddenError,
  AuthenticationError,
  CancelledError,
  StreamGrabError,
  DiskSpaceError,
  PermissionError,
  UnsupportedDrmError,
  ExpiredUrlError,
  MediaNotFoundError,
} from '../../src/core/errors.js';

test('STRATEGIES congelado com os 6 transportes', () => {
  assert.deepEqual(STRATEGIES, {
    MUX: 'mux',
    FFMPEG: 'ffmpeg',
    HTTP: 'http',
    RANGE: 'range',
    CURL: 'curl',
    YTDLP: 'ytdlp',
  });
  assert.ok(Object.isFrozen(STRATEGIES));
});

test('selectStrategy: prepared mux -> MUX', () => {
  assert.equal(selectStrategy({ prepared: { strategy: 'mux' } }), STRATEGIES.MUX);
});

test('selectStrategy: hls/dash -> FFMPEG', () => {
  assert.equal(selectStrategy({ sourceType: 'hls' }), STRATEGIES.FFMPEG);
  assert.equal(selectStrategy({ sourceType: 'dash' }), STRATEGIES.FFMPEG);
});

test('selectStrategy: youtube/social/ytdlp -> HTTP por padrao', () => {
  assert.equal(selectStrategy({ sourceType: 'youtube' }), STRATEGIES.HTTP);
  assert.equal(selectStrategy({ sourceType: 'social' }), STRATEGIES.HTTP);
  assert.equal(selectStrategy({ sourceType: 'ytdlp' }), STRATEGIES.HTTP);
});

test('selectStrategy: youtube + useYtDlpDownload + formatId -> YTDLP', () => {
  assert.equal(
    selectStrategy({ sourceType: 'youtube', options: { useYtDlpDownload: true, formatId: '137' } }),
    STRATEGIES.YTDLP
  );
});

test('selectStrategy: direct + turbo -> RANGE; direct sem turbo -> HTTP', () => {
  assert.equal(selectStrategy({ sourceType: 'direct', options: { turbo: true } }), STRATEGIES.RANGE);
  assert.equal(selectStrategy({ sourceType: 'direct' }), STRATEGIES.HTTP);
});

test('selectStrategy: fonte desconhecida -> HTTP (default seguro)', () => {
  assert.equal(selectStrategy({ sourceType: 'whatever' }), STRATEGIES.HTTP);
});

test('resolveFallback: NetworkError retryable -> retry na MESMA estrategia', () => {
  const r = resolveFallback({ strategy: STRATEGIES.RANGE, error: new NetworkError('reset', { retryable: true }) });
  assert.equal(r.action, 'retry');
  assert.equal(r.strategy, STRATEGIES.RANGE);
});

test('resolveFallback: RateLimitError (429) -> retry', () => {
  const r = resolveFallback({ strategy: STRATEGIES.HTTP, error: new RateLimitError('429', { status: 429 }) });
  assert.equal(r.action, 'retry');
});

test('resolveFallback: 403/Forbidden -> STOP — nao dispara loop de transports', () => {
  const r = resolveFallback({ strategy: STRATEGIES.RANGE, error: new ForbiddenError('403', { status: 403 }) });
  assert.equal(r.action, 'stop');
  assert.ok(r.reason.includes('sem loop de transports'), `reason inesperada: ${r.reason}`);
});

test('resolveFallback: RANGE_UNSUPPORTED no range -> fallback para http', () => {
  const err = new StreamGrabError('sem Range', { code: 'RANGE_UNSUPPORTED' });
  const r = resolveFallback({ strategy: STRATEGIES.RANGE, error: err });
  assert.equal(r.action, 'fallback');
  assert.equal(r.strategy, STRATEGIES.HTTP);
});

test('resolveFallback: INVALID_CONTENT_RANGE no range -> fallback para http', () => {
  const err = new StreamGrabError('Content-Range invalido', { code: 'INVALID_CONTENT_RANGE' });
  const r = resolveFallback({ strategy: STRATEGIES.RANGE, error: err });
  assert.equal(r.action, 'fallback');
  assert.equal(r.strategy, STRATEGIES.HTTP);
});

test('resolveFallback: 401/Auth, DRM, URL expirada, not-media, disco, permissao -> STOP', () => {
  const cases = [
    new AuthenticationError('401', { status: 401 }),
    new UnsupportedDrmError('DRM'),
    new ExpiredUrlError('expirada'),
    new MediaNotFoundError('404'),
    new StreamGrabError('html no lugar de midia', { code: 'NOT_MEDIA' }),
    new DiskSpaceError('ENOSPC', { code: 'ENOSPC' }),
    new PermissionError('EACCES', { code: 'EACCES' }),
    new CancelledError('cancelado'),
  ];
  for (const err of cases) {
    const r = resolveFallback({ strategy: STRATEGIES.HTTP, error: err });
    assert.equal(r.action, 'stop', `esperado stop para ${err.code}`);
    assert.ok(r.reason.includes('sem loop de transports'), `reason inesperada: ${r.reason}`);
  }
});

test('resolveFallback: RANGE_UNSUPPORTED fora do range -> stop (sem fallback definido)', () => {
  const err = new StreamGrabError('sem Range', { code: 'RANGE_UNSUPPORTED' });
  const r = resolveFallback({ strategy: STRATEGIES.HTTP, error: err });
  assert.equal(r.action, 'stop');
});

test('canFallback: true para retry e fallback; false para terminal', () => {
  assert.equal(canFallback({ strategy: STRATEGIES.HTTP, error: new NetworkError('x', { retryable: true }) }), true);
  assert.equal(
    canFallback({
      strategy: STRATEGIES.RANGE,
      error: new StreamGrabError('sem Range', { code: 'RANGE_UNSUPPORTED' }),
    }),
    true
  );
  assert.equal(canFallback({ strategy: STRATEGIES.HTTP, error: new ForbiddenError('403', { status: 403 }) }), false);
});

test('isTerminalError: 403/401/cancelado -> true; Network/429 -> false', () => {
  assert.equal(isTerminalError(new ForbiddenError('403', { status: 403 })), true);
  assert.equal(isTerminalError(new AuthenticationError('401', { status: 401 })), true);
  assert.equal(isTerminalError(new CancelledError('cancelado')), true);
  assert.equal(isTerminalError(new NetworkError('reset', { retryable: true })), false);
  assert.equal(isTerminalError(new RateLimitError('429', { status: 429 })), false);
});
