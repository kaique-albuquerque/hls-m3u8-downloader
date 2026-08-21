import { formatBytes } from './utils.js';

export function createProgressReporter(io, { totalBytes = 0, label = 'Baixando' } = {}) {
  let size = 0;
  let lastFrame = '';
  const width = 22;

  function renderFrame() {
    const percent = totalBytes > 0 ? Math.min(100, Math.round((size / totalBytes) * 100)) : null;
    const bar =
      percent == null
        ? `[${'·'.repeat(width)}]`
        : `[${'█'.repeat(Math.round((percent / 100) * width))}${'░'.repeat(width - Math.round((percent / 100) * width))}] ${String(percent).padStart(3)}%`;
    return `${label}  ${bar}  ${formatBytes(size)}${totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ''}`;
  }

  return {
    update(bytesDownloaded) {
      size = bytesDownloaded;
      const frame = renderFrame();
      if (frame !== lastFrame) {
        lastFrame = frame;
        process.stdout.write(`\r${frame}\x1b[K`);
      }
      io.onProgress?.({ bytesDownloaded, totalBytes });
    },
    finish(success = true) {
      process.stdout.write(`\r${' '.repeat(Math.max(0, lastFrame.length))}\r${success ? `${label} concluido.` : `${label} falhou.`}\n`);
    },
  };
}
