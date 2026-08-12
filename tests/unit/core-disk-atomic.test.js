import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getFreeBytes, checkDiskSpace, estimateMuxSpace } from '../../src/core/disk.js';
import { createAtomicFile, moveIntoPlace, cleanupPart } from '../../src/core/atomic.js';
import { DiskSpaceError } from '../../src/core/errors.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-disk-test-'));
}

// ---------------------------------------------------------------------------
// Disk
// ---------------------------------------------------------------------------

test('getFreeBytes retorna numero positivo (ou null sem lancar)', async () => {
  const free = await getFreeBytes(makeTempDir());
  if (free !== null) {
    assert.ok(free > 0, `bytes livres deve ser > 0, veio ${free}`);
  }
});

test('getFreeBytes com diretorio inexistente retorna null (nao lanca)', async () => {
  const free = await getFreeBytes(path.join(makeTempDir(), 'nao-existe'));
  assert.equal(free, null);
});

test('estimateMuxSpace reserva 2.2x + margem fixa', () => {
  const est = estimateMuxSpace(100 * 1024 * 1024);
  assert.ok(est > 100 * 1024 * 1024 * 2, 'reserva video+audio+saida');
  assert.ok(est < 100 * 1024 * 1024 * 3, 'nao exagera');
});

test('checkDiskSpace lanca DiskSpaceError amigavel quando falta espaco', async () => {
  await assert.rejects(
    () => checkDiskSpace({ dir: makeTempDir(), requiredBytes: Number.MAX_SAFE_INTEGER }),
    (err) => err instanceof DiskSpaceError && err.code === 'DISK_SPACE_ERROR' && /insuficiente/i.test(err.message)
  );
});

test('checkDiskSpace passa quando ha espaco de sobra', async () => {
  const ok = await checkDiskSpace({ dir: makeTempDir(), requiredBytes: 1024 });
  assert.equal(ok, true);
});

test('checkDiskSpace com dir inexistente nao bloqueia (free null)', async () => {
  const ok = await checkDiskSpace({ dir: path.join(makeTempDir(), 'x'), requiredBytes: 1024 });
  assert.equal(ok, true);
});

// ---------------------------------------------------------------------------
// Atomic (.part -> rename)
// ---------------------------------------------------------------------------

test('createAtomicFile grava em .part, commit renomeia e valida', async () => {
  const dir = makeTempDir();
  const af = createAtomicFile({ dir, filename: 'video.mp4' });
  assert.equal(af.partPath, path.join(dir, 'video.mp4.part'));
  assert.equal(af.finalPath, path.join(dir, 'video.mp4'));

  await af.write(Buffer.from('primeira-parte'));
  await af.write(Buffer.from('-segunda-parte'));
  assert.equal(af.exists(), true);
  assert.equal(fs.existsSync(af.finalPath), false, 'ainda nao finalizado');

  const final = await af.commit();
  assert.equal(final, af.finalPath);
  assert.equal(fs.readFileSync(af.finalPath, 'utf8'), 'primeira-parte-segunda-parte');
  assert.equal(fs.existsSync(af.partPath), false, '.part removido apos commit');
});

test('createAtomicFile nao cria o arquivo final antes do commit', async () => {
  const dir = makeTempDir();
  const af = createAtomicFile({ dir, filename: 'x.bin' });
  await af.write(Buffer.from([1, 2, 3]));
  assert.equal(fs.existsSync(af.finalPath), false);
  await af.commit();
  assert.equal(fs.existsSync(af.finalPath), true);
});

test('commit rejeita arquivo parcial vazio (EMPTY_PARTIAL)', async () => {
  const dir = makeTempDir();
  const af = createAtomicFile({ dir, filename: 'vazio.bin' });
  fs.writeFileSync(af.partPath, ''); // simula arquivo vazio
  await assert.rejects(() => af.commit(), (err) => err.code === 'EMPTY_PARTIAL');
});

test('abort remove o .part sem tocar no final', async () => {
  const dir = makeTempDir();
  const af = createAtomicFile({ dir, filename: 'abortado.bin' });
  await af.write(Buffer.from('parcial'));
  fs.writeFileSync(af.finalPath, 'completo'); // versao anterior existente
  await af.abort();
  assert.equal(fs.existsSync(af.partPath), false);
  assert.equal(fs.readFileSync(af.finalPath, 'utf8'), 'completo', 'final preservado');
});

test('moveIntoPlace valida tamanho > 0 e move', () => {
  const dir = makeTempDir();
  const part = path.join(dir, 'a.mp4.part');
  const final = path.join(dir, 'a.mp4');
  fs.writeFileSync(part, 'conteudo');
  const out = moveIntoPlace(part, final);
  assert.equal(out, final);
  assert.equal(fs.readFileSync(final, 'utf8'), 'conteudo');
  assert.equal(fs.existsSync(part), false);
});

test('moveIntoPlace rejeita .part vazio ou ausente', () => {
  const dir = makeTempDir();
  assert.throws(() => moveIntoPlace(path.join(dir, 'nao-existe.part'), path.join(dir, 'x.mp4')), (err) => err.code === 'PARTIAL_NOT_FOUND');
  const vazio = path.join(dir, 'vazio.part');
  fs.writeFileSync(vazio, '');
  assert.throws(() => moveIntoPlace(vazio, path.join(dir, 'x.mp4')), (err) => err.code === 'EMPTY_PARTIAL');
});

test('cleanupPart ignora arquivo ausente', () => {
  cleanupPart(path.join(makeTempDir(), 'nada.part')); // nao lanca
});
