import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMuxDownload } from '../ffmpeg.js';
import { formatBytes } from '../utils.js';
import { createProgressReporter } from './progress.js';
import { cleanupPartial } from './download.js';

/** Quantidade padrao de conexoes paralelas no modo turbo. */
export const DEFAULT_TURBO_CHUNKS = 8;

const EMIT_INTERVAL_MS = 200;

/**
 * Verifica se o servidor aceita Range (download por partes). Dispara uma
 * requisicao "bytes=0-0": se responder 206 com content-range, o turbo e valido.
 */
async function probeRange(url, headers, signal) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { ...headers, Range: 'bytes=0-0' },
    signal,
    redirect: 'follow',
  });
  try {
    if (res.status === 206) {
      const m = /bytes\s+\d+-\d+\/(\d+)/.exec(res.headers.get('content-range') || '');
      const total = m ? Number(m[1]) : 0;
      return { ok: total > 0, total };
    }
    return { ok: false, total: 0 };
  } finally {
    await res.body?.cancel?.().catch(() => {});
  }
}

/**
 * Baixa um arquivo (URL direta) em N conexoes paralelas via HTTP Range,
 * escrevendo cada parte na posicao correta do arquivo final.
 *
 * Retorna { ok: true } em sucesso, { ok: false, error: 'no-range' } quando o
 * servidor nao suporta Range (chamador deve cair no fluxo FFmpeg normal) e
 * { ok: false, interrupted: true } em cancelamento.
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

  const started = Date.now();
  let downloaded = 0;
  let lastEmit = 0;
  let fh = null;

  try {
    let probe;
    try {
      probe = await probeRange(url, headers, abort.signal);
    } catch (err) {
      if (abort.signal.aborted) return { ok: false, interrupted: true };
      ctx.io.log(`[AVISO] Turbo: ${err.message}`);
      return { ok: false, error: 'no-range' };
    }
    if (!probe.ok) {
      ctx.io.log('[AVISO] Turbo: o servidor nao suporta download por partes (Range). Usando fluxo normal.');
      return { ok: false, error: 'no-range' };
    }

    const total = probe.total;
    const progress = createProgressReporter(ctx.io, { totalBytes: total, durationMs, label });

    const emit = () => {
      const now = Date.now();
      if (now - lastEmit < EMIT_INTERVAL_MS) return;
      lastEmit = now;
      const elapsed = (now - started) / 1000;
      const speed = elapsed > 0 ? downloaded / elapsed : 0;
      const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');
      progress.update({ key: 'out_time', value: `${hh}:${mm}:${ss}` });
      progress.update({ key: 'total_size', value: downloaded });
      progress.update({ key: 'speed', value: `${formatBytes(speed)}/s` });
    };

    // Divide o arquivo em intervalos [inicio, fim].
    const chunkSize = Math.ceil(total / chunkCount);
    const ranges = [];
    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      if (start >= total) break;
      ranges.push([start, Math.min(total - 1, start + chunkSize - 1)]);
    }

    try {
      fh = await fs.promises.open(output, 'w');
      await fh.truncate(total);
    } catch (err) {
      ctx.io.log(`[AVISO] Turbo: nao foi possivel criar o arquivo final: ${err.message}`);
      return { ok: false, error: 'other' };
    }

    const chunkTasks = ranges.map(async ([start, end]) => {
      const chunkAbort = new AbortController();
      const onAbort = () => chunkAbort.abort();
      abort.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { ...headers, Range: `bytes=${start}-${end}` },
          signal: chunkAbort.signal,
          redirect: 'follow',
        });
        if (res.status !== 206 || !res.body) {
          const err = new Error('o servidor nao respondeu 206 para Range');
          err.code = 'TURBO_NO_RANGE';
          throw err;
        }
        const reader = res.body.getReader();
        let pos = start;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.byteLength) {
            await fh.write(value, 0, value.byteLength, pos);
            pos += value.byteLength;
            downloaded += value.byteLength;
            emit();
          }
        }
      } finally {
        abort.signal.removeEventListener('abort', onAbort);
      }
    });

    await Promise.all(chunkTasks);
    await fh.close().catch(() => {});
    fh = null;

    if (abort.signal.aborted) {
      cleanupPartial(output);
      return { ok: false, interrupted: true };
    }

    progress.update({ key: 'total_size', value: total });
    progress.update({ key: 'progress', value: 'end' });
    progress.finish();
    ctx.io.log(`[turbo] Download concluido com ${ranges.length} conexoes paralelas.`);
    return { ok: true };
  } catch (err) {
    if (abort.signal.aborted) {
      cleanupPartial(output);
      return { ok: false, interrupted: true };
    }
    if (err?.code === 'TURBO_NO_RANGE') {
      ctx.io.log('[AVISO] Turbo: o servidor parou de responder Range no meio do download. Usando fluxo normal.');
      cleanupPartial(output);
      return { ok: false, error: 'no-range' };
    }
    ctx.io.log(`[AVISO] Turbo falhou (${err.message}). Usando fluxo normal.`);
    cleanupPartial(output);
    return { ok: false, error: 'other' };
  } finally {
    if (fh) await fh.close().catch(() => {});
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
    const { promise, stop } = startMuxDownload({
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
