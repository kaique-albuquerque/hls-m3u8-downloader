import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getMp4decryptCommand, hasMp4decrypt, getWidevineCdmPath, PROJECT_ROOT } from '../../src/core/binaries.js';
import { DrmInfraError, DrmLicenseError, DrmDecryptError, friendlyReport } from '../../src/core/errors.js';

test('binaries: getMp4decryptCommand retorna caminho vendor ou nome puro', () => {
  const cmd = getMp4decryptCommand();
  assert.ok(typeof cmd === 'string' && cmd.length > 0);
  const local = path.join(PROJECT_ROOT, 'vendor', 'mp4decrypt', process.platform === 'win32' ? 'mp4decrypt.exe' : 'mp4decrypt');
  if (fs.existsSync(local)) {
    assert.equal(cmd, local);
  } else {
    assert.ok(cmd.includes('mp4decrypt'));
  }
});

test('binaries: hasMp4decrypt não lança', () => {
  assert.equal(typeof hasMp4decrypt(), 'boolean');
});

test('binaries: getWidevineCdmPath retorna string (vazia se ausente)', () => {
  const p = getWidevineCdmPath();
  assert.equal(typeof p, 'string');
});

test('errors: DrmInfraError tem código DRM_INFRA_ERROR', () => {
  const err = new DrmInfraError('teste');
  assert.equal(err.code, 'DRM_INFRA_ERROR');
  assert.equal(err.retryable, false);
});

test('errors: DrmLicenseError é retryable', () => {
  const err = new DrmLicenseError('teste');
  assert.equal(err.code, 'DRM_LICENSE_ERROR');
  assert.equal(err.retryable, true);
});

test('errors: DrmDecryptError tem código DRM_DECRYPT_ERROR', () => {
  const err = new DrmDecryptError('teste');
  assert.equal(err.code, 'DRM_DECRYPT_ERROR');
  assert.equal(err.retryable, false);
});

test('errors: friendlyReport serializa classes DRM', () => {
  const report = friendlyReport(new DrmLicenseError('licença recusada'));
  assert.equal(report.code, 'DRM_LICENSE_ERROR');
  assert.equal(report.retryable, true);
  assert.ok(report.suggestedAction.length > 0);
});
