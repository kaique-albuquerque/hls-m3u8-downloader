import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as core from '../../src/core/index.js';
import { StreamGrabCore, createStreamGrabCore } from '../../src/core/registry.js';
import { EVENT_NAMES } from '../../src/core/events.js';
import { StreamGrabError, classifyError } from '../../src/core/errors.js';
import { createMediaInfo, createDownloadJob } from '../../src/core/models.js';
import { sanitizeFilename, resolveSafeFilename } from '../../src/core/filenames.js';
import { createLogger, redactText } from '../../src/core/logger.js';

test('core-index: re-exporta a fachada e os modulos core', () => {
  assert.equal(core.StreamGrabCore, StreamGrabCore);
  assert.equal(core.createStreamGrabCore, createStreamGrabCore);
  assert.equal(typeof core.createDefaultExecutor, 'function');
  assert.deepEqual(core.EVENT_NAMES, EVENT_NAMES);
  assert.equal(core.StreamGrabError, StreamGrabError);
  assert.equal(core.classifyError, classifyError);
  assert.equal(core.createMediaInfo, createMediaInfo);
  assert.equal(core.createDownloadJob, createDownloadJob);
  assert.equal(core.sanitizeFilename, sanitizeFilename);
  assert.equal(core.resolveSafeFilename, resolveSafeFilename);
  assert.equal(core.createLogger, createLogger);
  assert.equal(core.redactText, redactText);
});

test('core-index: API publica consumivel de forma unica por CLI/Electron', () => {
  const api = Object.keys(core).sort();
  for (const expected of [
    'StreamGrabCore',
    'createStreamGrabCore',
    'createDefaultExecutor',
    'createEventBus',
    'createProgressPayload',
    'classifyError',
    'createLogger',
    'createDownloadJob',
    'createMediaInfo',
    'resolveSafeFilename',
  ]) {
    assert.ok(api.includes(expected), `esperado export ${expected}`);
  }
});
