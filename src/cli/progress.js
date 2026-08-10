import { formatBytes } from '../utils.js';

/**
 * Reporta o progresso do FFmpeg (-progress pipe:1) tanto no CLI quanto no
 * Electron.
 *
 * CLI: renderiza uma barra no terminal usando \r (mesma linha).
 * Electron: usa io.onStatus/io.onProgress.
 *
 * - Com totalBytes ou durationMs conhecidos -> barra determinada com %.
 * - Sem total (ex.: HLS) -> barra indeterminada com ponto pulsante.
 */
export function createProgressReporter(io, { totalBytes = 0, durationMs = 0, label = 'Baixando' } = {}) {
  let time = '';
  let size = 0;
  let speed = '';
  let outTimeMs = 0;
  let lastFrame = '';
  const cliMode = typeof io.onStatus !== 'function';
  const BAR_WIDTH = 22;

  const computePercent = () => {
    if (totalBytes > 0 && size > 0) {
      return Math.min(100, Math.max(0, Math.round((size / totalBytes) * 100)));
    }
    if (durationMs > 0 && outTimeMs > 0) {
      return Math.min(100, Math.max(0, Math.round((outTimeMs / durationMs) * 100)));
    }
    return null;
  };

  const renderFrame = () => {
    const pct = computePercent();
    let bar;
    if (pct === null) {
      const pos = Math.floor(Date.now() / 400) % Math.max(1, BAR_WIDTH - 2);
      const cells = [];
      for (let i = 0; i < BAR_WIDTH - 2; i++) cells.push(i === pos ? '█' : '·');
      bar = `[${cells.join('')}]`;
    } else {
      const filled = Math.round((pct / 100) * BAR_WIDTH);
      bar = `[${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}] ${String(pct).padStart(3)}%`;
    }
    const parts = [`${label}  ${bar}`];
    if (size > 0) parts.push(totalBytes > 0 ? `${formatBytes(size)} / ${formatBytes(totalBytes)}` : formatBytes(size));
    if (time) parts.push(`Tempo: ${time}`);
    if (speed) parts.push(`Velocidade: ${speed}`);
    return parts.join('  ');
  };

  return {
    update({ key, value }) {
      if (key === 'out_time') time = String(value).slice(0, 8);
      else if (key === 'out_time_ms') outTimeMs = Number(value) || 0;
      else if (key === 'total_size') size = Number(value) || 0;
      else if (key === 'speed') {
        const s = String(value).trim();
        if (s && s !== 'N/A') speed = s;
      }

      io.onProgress?.({
        key,
        value,
        time,
        size: formatBytes(size),
        speed,
        duration: durationMs > 0 ? Math.round(durationMs / 1000) : undefined,
      });

      if (key === 'progress' || key === 'out_time' || key === 'out_time_ms' || key === 'total_size' || key === 'speed') {
        const frame = renderFrame();
        if (cliMode) {
          if (frame !== lastFrame) {
            lastFrame = frame;
            process.stdout.write(`\r${frame}\x1b[K`);
          }
        } else {
          io.onStatus?.(frame);
        }
      }
    },
    finish() {
      if (cliMode) {
        process.stdout.write(`\r${' '.repeat(Math.max(0, lastFrame.length))}\r${label} concluido.\n`);
        lastFrame = '';
      }
      io.onProgressEnd?.();
    },
  };
}
