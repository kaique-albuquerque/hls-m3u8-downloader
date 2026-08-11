import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mux } from '../ffmpeg/muxer.js';
import { formatBytes } from '../utils.js';
import { downloadParallelRanges, probeRangeSupport } from '../transports/range.js';
import { createProgressReporter } from './progress.js';
import { cleanupPartial } from './download.js';

/** Quantidade padrao de conexoes paralelas no modo turbo. */
export const DEFAULT_TURBO_CHUNKS = 8;

/**
 * Verifica se o servidor aceita Range (download por partes). Dispara uma
 * requisicao "bytes=0-0": se responder 206 com content-range, o turbo e valido.
 * (P4: delega ao transporte Range — `probeRangeSupport`.)
 */
async function probeRange(url, headers, signal) {
  const probe = await probeRangeSupport(url, { headers, signal });
  return { ok: probe.ok, total: probe.total };
}

/**
 * Fluxo turbo (P4): delega ao transporte Range (`src/transports/range.js`),
 * mantendo a API publica atual:
 *   { ok: true } | { ok: false, error: 'no-range' } | { ok: false, interrupted: true } | { ok: false, error: 'other' }
 *
 * `signal` (opcional) e um AbortController — mesmo contrato dos fluxos legados.
 */
export async function runTurboDownloadFlow(ctx, {
  url,
  output,
  headers = {},
  durationMs = 0,
  label = 'Baixando',
  chunkCount = DEFAULT_TURBO_CHUNKS,
  signal,
}) {
  const ownAbort = new AbortController();
  const abort = signal || ownAbort;
  if (!signal) ctx.turboAbort = ownAbort;
  const sig = abort.signal;

  try {
    // 1) Sonda o suporte a Range para informar o total ao reporter de progresso.
    let probe;
    try {
      probe = await probeRange(url, headers, sig);
    } catch (err) {
      if (sig.aborted) return { ok: false, interrupted: true };
      ctx.io.log(`[AVISO] Turbo: ${err.message}`);
      return { ok: false, error: 'no-range' };
    }
    if (!probe.ok) {
      ctx.io.log('[AVISO] Turbo: o servidor nao suporta download por partes (Range). Usando fluxo normal.');
      return { ok: false, error: 'no-range' };
    }

    const total = probe.total;
    const progress = createProgressReporter(ctx.io, { totalBytes: total, durationMs, label });
    const onTransportProgress = (u) => {
      if (u.bytesDownloaded != null) progress.update({ key: 'total_size', value: u.bytesDownloaded });
      if (u.speed) progress.update({ key: 'speed', value: `${formatBytes(u.speed)}/s` });
    };

    // 2) Limite de conexoes do ResourceManager (quando presente no ctx).
    const available = ctx.resourceLimiter?.connections?.available;
    const concurrency = available != null ? Math.max(1, Math.min(chunkCount, available || 1)) : chunkCount;

    // 3) Download paralelo via transporte Range.
    await downloadParallelRanges({
      url,
      output,
      headers,
      signal: sig,
      chunkCount,
      concurrency,
      onProgress: onTransportProgress,
    });

    if (sig.aborted) {
      cleanupPartial(output);
      return { ok: false, interrupted: true };
    }

    progress.update({ key: 'total_size', value: total });
    progress.update({ key: 'progress', value: 'end' });
    progress.finish();
    ctx.io.log(`[turbo] Download concluido com ${chunkCount} conexoes paralelas.`);
    return { ok: true };
  } catch (err) {
    if (sig.aborted) {
      cleanupPartial(output);
      return { ok: false, interrupted: true };
    }
    if (err?.code === 'RANGE_UNSUPPORTED' || err?.code === 'INVALID_CONTENT_RANGE') {
      ctx.io.log('[AVISO] Turbo: o servidor parou de responder Range no meio do download. Usando fluxo normal.');
      cleanupPartial(output);
      return { ok: false, error: 'no-range' };
    }
    ctx.io.log(`[AVISO] Turbo falhou (${err.message}). Usando fluxo normal.`);
    cleanupPartial(output);
    return { ok: false, error: 'other' };
  } finally {
    if (!signal) ctx.turboAbort = null;
  }
}

/**
 * Fluxo turbo para formatos adaptativos (video + audio separados): baixa os
 * dois em paralelo e junta com FFmpeg (-c copy), igual ao runMuxedDownloadFlow.
 */
export async function runTurboMuxedDownloadFlow(ctx, {
  videoUrl,
  audioUrl,
  output,
  headers,
  durationMs,
}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-turbo-'));
  const videoTmp = path.join(tmpDir, 'video.part.mp4');
  const audioTmp = path.join(tmpDir, 'audio.part.m4a');

  try {
    ctx.io.log('\nBaixando video e audio em paralelo (turbo)...');
    const abort = new AbortController();
    ctx.turboAbort = abort;
    const [video, audio] = await Promise.all([
      runTurboDownloadFlow(ctx, { url: videoUrl, output: videoTmp, headers, durationMs, label: 'Video', signal: abort }),
      runTurboDownloadFlow(ctx, { url: audioUrl, output: audioTmp, headers, durationMs, label: 'Audio', signal: abort }),
    ]);
    ctx.turboAbort = null;
    if (!video.ok) return video;
    if (!audio.ok) return audio;
    if (abort.signal.aborted) {
      cleanupPartial(output);
      return { ok: false, interrupted: true };
    }

    ctx.io.log('\nJuntando video e audio com FFmpeg...');
    const progress = createProgressReporter(ctx.io, { durationMs, label: 'Juntando video e audio' });
    const { promise, stop } = mux({
      videoInput: videoTmp,
      audioInput: audioTmp,
      output,
      onProgress: progress.update,
    });
    ctx.currentFfmpeg = { stop };
    const result = await promise;
    ctx.currentFfmpeg = null;
    progress.finish();
    if (result.ok) return { ok: true };
    if (result.interrupted || ctx.interruptHandled) {
      cleanupPartial(output);
      return { ok: false, interrupted: true };
    }
    cleanupPartial(output);
    return { ok: false, error: 'mux' };
  } finally {
    ctx.turboAbort = null;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  }
}
