import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// P5: delega ao muxer (modos copy/adtstoasc/aac) — contrato identico ao legado.
import { startDownload, startMuxDownload } from '../ffmpeg/muxer.js';
import { maskUrl } from '../utils.js';
import { MODE_LABELS } from './context.js';
import { createProgressReporter } from './progress.js';
import { print403 } from './ui.js';

export function cleanupPartial(output) {
  try {
    if (fs.existsSync(output)) fs.unlinkSync(output);
  } catch {
    /* ignora */
  }
}

export function analyzeFailure(result) {
  const stderr = String(result?.stderr || '').toLowerCase();
  if (stderr.includes('403') || stderr.includes('forbidden')) return '403';
  if (
    stderr.includes('could not find tag') ||
    stderr.includes('not currently supported in container') ||
    stderr.includes('audio codec') ||
    stderr.includes('invalid data') ||
    stderr.includes('moov atom not found')
  ) {
    return 'incompatibilidade de audio/container';
  }
  return `codigo de saida ${result?.code ?? 'desconhecido'}`;
}

export function printStderrTail(io, result, url) {
  const stderr = String(result?.stderr || '');
  const masked = !url ? stderr : stderr.split(url).join(maskUrl(url));
  const lines = masked.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-15);
  if (tail.length) {
    io.log('\nUltimas mensagens do FFmpeg:');
    for (const line of tail) io.log(`  ${line}`);
  }
}

export async function runDownloadFlow(ctx, { url, output, headers, extraArgs = [], outputArgs = [], totalBytes, durationMs, label }) {
  let lastResult = null;

  for (let modeIndex = 0; modeIndex < MODE_LABELS.length; modeIndex++) {
    ctx.io.log(`\nBaixando - modo: ${MODE_LABELS[modeIndex]}`);
    ctx.io.onState?.({ state: `running:${modeIndex}`, label: MODE_LABELS[modeIndex], modeIndex });
    const progress = createProgressReporter(ctx.io, { totalBytes, durationMs, label });
    const { promise, stop } = startDownload({
      url,
      output,
      headers,
      modeIndex,
      extraArgs,
      outputArgs,
      onProgress: progress.update,
    });

    ctx.currentFfmpeg = { stop };
    ctx.interruptHandled = false;
    const result = await promise;
    ctx.currentFfmpeg = null;
    progress.finish(result.ok);

    if (result.ok) {
      return { ok: true, modeIndex };
    }
    if (result.interrupted || ctx.interruptHandled) {
      ctx.io.log('\nDownload interrompido.');
      cleanupPartial(output);
      return { ok: false, interrupted: true };
    }

    lastResult = result;
    const reason = analyzeFailure(result);
    if (reason === '403') {
      print403(ctx.io);
      cleanupPartial(output);
      return { ok: false, error: '403' };
    }

    ctx.io.log(`[AVISO] Falha no modo "${MODE_LABELS[modeIndex]}": ${reason}`);
    if (modeIndex < MODE_LABELS.length - 1) {
      ctx.io.log('Tentando um modo alternativo...');
      ctx.io.onState?.({ state: `retrying:${modeIndex}`, label: MODE_LABELS[modeIndex], modeIndex });
    }
  }

  cleanupPartial(output);
  printStderrTail(ctx.io, lastResult, url);
  return { ok: false, error: 'other' };
}

export async function runMuxedDownloadFlow(ctx, { videoUrl, audioUrl, output, headers, videoBytes, audioBytes, totalBytes, durationMs }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-yt-'));
  const videoTmp = path.join(tmpDir, 'video.part.mp4');
  const audioTmp = path.join(tmpDir, 'audio.part.m4a');
  const progress = createProgressReporter(ctx.io, { durationMs, label: 'Juntando video e audio' });

  try {
    ctx.io.log('\nBaixando video adaptativo do YouTube...');
    let step = await runDownloadFlow(ctx, { url: videoUrl, output: videoTmp, headers, totalBytes: videoBytes, durationMs, label: 'Video' });
    if (!step.ok) return step;

    ctx.io.log('\nBaixando audio adaptativo do YouTube...');
    step = await runDownloadFlow(ctx, { url: audioUrl, output: audioTmp, headers, totalBytes: audioBytes, durationMs, label: 'Audio' });
    if (!step.ok) return step;

    ctx.io.log('\nJuntando video e audio com FFmpeg...');
    const { promise, stop } = startMuxDownload({
      videoInput: videoTmp,
      audioInput: audioTmp,
      output,
      onProgress: progress.update,
    });
    ctx.currentFfmpeg = { stop };
    const result = await promise;
    ctx.currentFfmpeg = null;
    progress.finish(result.ok);
    if (result.ok) return { ok: true, modeIndex: 0 };
    if (result.interrupted || ctx.interruptHandled) {
      cleanupPartial(output);
      return { ok: false, interrupted: true };
    }
    cleanupPartial(output);
    printStderrTail(ctx.io, result, '');
    return { ok: false, error: 'mux' };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  }
}
