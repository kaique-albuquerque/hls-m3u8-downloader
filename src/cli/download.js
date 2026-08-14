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

// ---------------------------------------------------------------------------
// P12.1: Multi-audio download flow
// ---------------------------------------------------------------------------

/**
 * Downloads video + N audio tracks and muxes with FFmpeg.
 * Each audio track is downloaded separately, then all are muxed together.
 */
export async function runMuxMultiDownloadFlow(ctx, { videoUrl, audioUrls = [], audioLabels = [], audioLanguages = [], output, headers, totalBytes, durationMs }) {
  if (!audioUrls.length) {
    return { ok: false, error: 'no-audio-tracks' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-mux-multi-'));
  const videoTmp = path.join(tmpDir, 'video.part.mp4');
  const audioTmps = audioUrls.map((_, i) => path.join(tmpDir, `audio_${i}.part.m4a`));
  const progress = createProgressReporter(ctx.io, { durationMs, label: 'Juntando video + audios' });

  try {
    // 1) Download video
    ctx.io.log('\nBaixando video...');
    let step = await runDownloadFlow(ctx, { url: videoUrl, output: videoTmp, headers, durationMs, label: 'Video' });
    if (!step.ok) return step;

    // 2) Download each audio track
    for (let i = 0; i < audioUrls.length; i++) {
      const label = audioLabels[i] || audioLanguages[i] || `audio ${i + 1}`;
      ctx.io.log(`\nBaixando audio ${i + 1}/${audioUrls.length} (${label})...`);
      step = await runDownloadFlow(ctx, { url: audioUrls[i], output: audioTmps[i], headers, durationMs, label });
      if (!step.ok) return step;
    }

    // 3) Mux with FFmpeg: -i video -i audio0 -i audio1 ... -map 0:v -map 1:a -map 2:a ...
    ctx.io.log('\nJuntando video + audios com FFmpeg...');

    const ffmpegArgs = [
      '-hide_banner', '-loglevel', 'error', '-nostats', '-y',
      '-i', videoTmp,
    ];

    // Audio inputs
    for (const audioTmp of audioTmps) {
      ffmpegArgs.push('-i', audioTmp);
    }

    ffmpegArgs.push('-progress', 'pipe:1');

    // Maps: video from input 0, audio from each subsequent input
    ffmpegArgs.push('-map', '0:v:0');
    for (let i = 0; i < audioTmps.length; i++) {
      ffmpegArgs.push('-map', `${i + 1}:a:0`);
    }

    // Copy all streams
    ffmpegArgs.push('-c:v', 'copy', '-c:a', 'copy');

    // Metadata for each audio track
    for (let i = 0; i < audioTmps.length; i++) {
      const lang = audioLanguages[i] || 'und';
      const label = audioLabels[i] || '';
      ffmpegArgs.push('-metadata:s:a:' + i, `language=${lang}`);
      if (label) ffmpegArgs.push('-metadata:s:a:' + i, `title=${label}`);
    }

    ffmpegArgs.push('-movflags', '+faststart', output);

    const { ffmpegService } = await import('../ffmpeg/service.js');
    const { promise, stop } = ffmpegService.run({
      args: ffmpegArgs,
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
    return { ok: false, error: 'mux-multi' };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  }
}
