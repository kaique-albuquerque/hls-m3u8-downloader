import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildResourcePlan, runResourcePlan } from '../../scripts/package-resources.mjs';

const FAKE_TOOLS = ['curl-impersonate.exe', 'curl_chrome146.bat', 'curl_chrome131.bat', 'random.txt'];

test('buildResourcePlan: entradas obrigatórias/opcionais + perfis v2', () => {
  const plan = buildResourcePlan({ projectRoot: 'P:/proj', listTools: () => FAKE_TOOLS });

  assert.equal(plan.entries.length, 3);
  const ffmpeg = plan.entries.find((e) => e.id === 'ffmpeg');
  const ytdlp = plan.entries.find((e) => e.id === 'yt-dlp');
  const curl = plan.entries.find((e) => e.id === 'curl-impersonate');

  assert.equal(ffmpeg.required, true);
  assert.ok(ffmpeg.from.endsWith(path.join('vendor', 'ffmpeg', 'ffmpeg.exe')));
  assert.equal(ytdlp.required, true);
  assert.ok(ytdlp.from.endsWith(path.join('node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe')));
  assert.equal(curl.required, false);

  // Perfis v2 copiados; arquivos sem padrão de perfil ignorados
  assert.deepEqual(
    plan.batProfiles.map((b) => b.to).sort(),
    ['curl_chrome131.bat', 'curl_chrome146.bat']
  );
});

test('buildResourcePlan: tools/ ausente não lança', () => {
  const plan = buildResourcePlan({ projectRoot: 'P:/proj', listTools: () => { throw new Error('ENOENT'); } });
  assert.deepEqual(plan.batProfiles, []);
  assert.equal(plan.entries.length, 3);
});

test('runResourcePlan: obrigatório ausente lança com mensagem clara', () => {
  const plan = buildResourcePlan({ projectRoot: 'P:/proj', listTools: () => [] });
  assert.throws(() => runResourcePlan(plan, { mkdir: () => {} }), /obrigatórios ausentes/);
});

test('runResourcePlan: copia entradas existentes para outDir (dirs reais temporários)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-plan-'));
  try {
    const proj = path.join(tmp, 'proj');
    const out = path.join(tmp, 'out', 'bin');
    const vendorFfmpeg = path.join(proj, 'vendor', 'ffmpeg');
    const ytdlpBin = path.join(proj, 'node_modules', 'youtube-dl-exec', 'bin');
    fs.mkdirSync(vendorFfmpeg, { recursive: true });
    fs.mkdirSync(ytdlpBin, { recursive: true });
    fs.writeFileSync(path.join(vendorFfmpeg, 'ffmpeg.exe'), 'ffmpeg-bytes');
    fs.writeFileSync(path.join(vendorFfmpeg, 'avcodec-63.dll'), 'avcodec-bytes');
    fs.writeFileSync(path.join(vendorFfmpeg, 'avformat-63.dll'), 'avformat-bytes');
    fs.writeFileSync(path.join(vendorFfmpeg, 'ffplay.exe'), 'ffplay-bytes'); // não é DLL → não copia
    fs.writeFileSync(path.join(ytdlpBin, 'yt-dlp.exe'), 'ytdlp-bytes');

    const plan = buildResourcePlan({ projectRoot: proj, listTools: () => [] });
    const result = runResourcePlan(plan, { outDir: out });
    // ffmpeg.exe + 2 DLLs + yt-dlp.exe (curl opcional ausente); ffplay.exe ignorado
    assert.equal(result.length, 4);
    assert.ok(fs.existsSync(path.join(out, 'ffmpeg.exe')));
    assert.ok(fs.existsSync(path.join(out, 'avcodec-63.dll')));
    assert.ok(fs.existsSync(path.join(out, 'avformat-63.dll')));
    assert.ok(fs.existsSync(path.join(out, 'yt-dlp.exe')));
    assert.equal(fs.existsSync(path.join(out, 'ffplay.exe')), false);
    assert.equal(fs.readFileSync(path.join(out, 'ffmpeg.exe'), 'utf8'), 'ffmpeg-bytes');
    assert.equal(fs.readFileSync(path.join(out, 'avcodec-63.dll'), 'utf8'), 'avcodec-bytes');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
