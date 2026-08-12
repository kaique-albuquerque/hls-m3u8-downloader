// P6.1 — core/session: decisao de resume + reanalise de URL expirada.
//
// Cobre (plano §13, risco alto "URL assinada expirada"):
//  - sem estado -> fresh; estado valido -> resume; tamanho mudou -> discard
//  - probeError nao-expirado -> error (sem renovacao)
//  - 403 (URL assinada expirada) + resolver -> UMA reanalise, nunca em loop
//    (URL igual -> error; URL nova + estado valido -> resume; estado invalido
//    -> discard; sem estado -> fresh; sem probeRange -> fresh)

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveResumeSession, isExpiredUrlError } from '../../src/core/session.js';
import { createState } from '../../src/core/resume.js';
import { ForbiddenError } from '../../src/core/errors.js';

const probe = (over = {}) => ({ total: 1000, etag: '"v1"', lastModified: 'LM1', ...over });

test('isExpiredUrlError: reconhece 403/EXPIRED_URL', () => {
  assert.equal(isExpiredUrlError({ code: 'FORBIDDEN_ERROR' }), true);
  assert.equal(isExpiredUrlError({ code: 'EXPIRED_URL' }), true);
  assert.equal(isExpiredUrlError({ code: 'EXPIRED_URL_ERROR' }), true);
  assert.equal(isExpiredUrlError({ code: 'RANGE_UNSUPPORTED' }), false);
  assert.equal(isExpiredUrlError({}), false);
});

test('sem estado anterior -> fresh', async () => {
  const d = await resolveResumeSession({ state: null, url: 'http://x/f.mp4', probe: probe() });
  assert.equal(d.action, 'fresh');
  assert.equal(d.reason, 'sem estado anterior');
});

test('estado valido (validators coincidem) -> resume', async () => {
  const state = createState({ url: 'u', destination: 'd', totalSize: 1000, etag: '"v1"', lastModified: 'LM1' });
  const d = await resolveResumeSession({ state, url: 'u', probe: probe() });
  assert.equal(d.action, 'resume');
  assert.equal(d.state, state);
});

test('tamanho mudou -> discard SIZE_CHANGED', async () => {
  const state = createState({ url: 'u', destination: 'd', totalSize: 1000 });
  const d = await resolveResumeSession({
    state,
    url: 'u',
    probe: { total: 2000, etag: null, lastModified: null },
  });
  assert.equal(d.action, 'discard');
  assert.equal(d.code, 'SIZE_CHANGED');
});

test('probeError nao-expirado sem resolver -> error', async () => {
  const err = new Error('boom');
  const d = await resolveResumeSession({ state: null, url: 'u', probe: null, probeError: err });
  assert.equal(d.action, 'error');
  assert.equal(d.error, err);
});

test('probeError 403 sem resolver -> error (nao ha como renovar)', async () => {
  const err = new ForbiddenError('403', { status: 403 });
  const d = await resolveResumeSession({ state: null, url: 'u', probe: null, probeError: err });
  assert.equal(d.action, 'error');
  assert.equal(d.error, err);
});

test('403 + resolver devolve a MESMA URL -> error (sem loop)', async () => {
  const err = new ForbiddenError('403', { status: 403 });
  let calls = 0;
  const d = await resolveResumeSession({
    state: null,
    url: 'u',
    probe: null,
    probeError: err,
    resolveFreshUrl: async () => {
      calls++;
      return { url: 'u' };
    },
  });
  assert.equal(d.action, 'error');
  assert.equal(calls, 1, 'resolver chamado, mas URL nao mudou -> sem reanalise');
});

test('403 + resolver URL nova + sem estado -> fresh (reanalise)', async () => {
  const err = new ForbiddenError('403', { status: 403 });
  const events = [];
  const d = await resolveResumeSession({
    state: null,
    url: 'http://a/f.mp4',
    probe: null,
    probeError: err,
    resolveFreshUrl: async () => ({ url: 'http://b/f.mp4' }),
    probeRange: async () => probe(),
    onReanalyze: (info) => events.push(info.reason),
  });
  assert.equal(d.action, 'fresh');
  assert.equal(d.url, 'http://b/f.mp4');
  assert.equal(events.length, 1, 'onReanalyze disparado uma vez');
});

test('403 + resolver URL nova + estado valido -> resume com URL renovada', async () => {
  const err = new ForbiddenError('403', { status: 403 });
  const state = createState({ url: 'http://a/f.mp4', destination: 'd', totalSize: 1000, etag: '"v1"' });
  const d = await resolveResumeSession({
    state,
    url: 'http://a/f.mp4',
    probe: null,
    probeError: err,
    resolveFreshUrl: async () => ({ url: 'http://b/f.mp4' }),
    probeRange: async () => probe({ etag: '"v1"' }),
  });
  assert.equal(d.action, 'resume');
  assert.equal(d.url, 'http://b/f.mp4');
  assert.equal(d.probe.etag, '"v1"');
});

test('403 + resolver URL nova + estado invalido -> discard ETAG_CHANGED', async () => {
  const err = new ForbiddenError('403', { status: 403 });
  const state = createState({ url: 'http://a/f.mp4', destination: 'd', totalSize: 1000, etag: '"v1"' });
  const d = await resolveResumeSession({
    state,
    url: 'http://a/f.mp4',
    probe: null,
    probeError: err,
    resolveFreshUrl: async () => ({ url: 'http://b/f.mp4' }),
    probeRange: async () => probe({ etag: '"v2"' }),
  });
  assert.equal(d.action, 'discard');
  assert.equal(d.code, 'ETAG_CHANGED');
  assert.equal(d.url, 'http://b/f.mp4');
});

test('403 + resolver URL nova + sem probeRange -> fresh', async () => {
  const err = new ForbiddenError('403', { status: 403 });
  const d = await resolveResumeSession({
    state: null,
    url: 'http://a/f.mp4',
    probe: null,
    probeError: err,
    resolveFreshUrl: async () => ({ url: 'http://b/f.mp4' }),
  });
  assert.equal(d.action, 'fresh');
  assert.equal(d.url, 'http://b/f.mp4');
});
