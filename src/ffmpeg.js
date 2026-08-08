import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Caminho do FFmpeg local (instalado por scripts/install-ffmpeg.mjs em
 * vendor/ffmpeg/). Se não existir, usa o comando 'ffmpeg' do PATH.
 */
export function getFfmpegCommand() {
  const local = path.join(PROJECT_ROOT, 'vendor', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return fs.existsSync(local) ? local : 'ffmpeg';
}

// Modos de extração. Sempre começamos com -c copy (sem recodificação,
// sem perda de qualidade). Os modos seguintes são fallback para
// incompatibilidade de áudio no container MP4.
const MODES = [
  { name: 'copy', args: ['-c', 'copy'] },
  { name: 'copy-adtstoasc', args: ['-c', 'copy', '-bsf:a', 'aac_adtstoasc'] },
  { name: 'aac', args: ['-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart'] },
];

/**
 * Verifica se o FFmpeg está instalado (local em vendor/ffmpeg ou no PATH).
 * Retorna true/false (nunca lança exceção).
 */
export function checkFfmpeg() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(getFfmpegCommand(), ['-version'], { windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0 && /ffmpeg version/i.test(out)));
  });
}

/**
 * Converte o objeto de headers em uma única string no formato
 * exigido pelo parâmetro -headers do FFmpeg (linhas separadas por CRLF).
 */
function formatHeaders(headers) {
  const entries = Object.entries(headers || {}).filter(([, v]) => v && String(v).trim());
  if (!entries.length) return '';
  return entries.map(([k, v]) => `${k}: ${String(v).trim()}\r\n`).join('');
}

/**
 * Inicia o FFmpeg via child_process.spawn — nunca via exec/string,
 * portanto URLs longas com & ? = % e paths com espaços não dependem
 * de escaping do shell.
 *
 * Retorna { promise, stop, mode }.
 *  - promise resolve com { ok, code, stderr, interrupted }
 *  - stop() encerra o FFmpeg de forma graciosa (escreve 'q' no stdin
 *    e força SIGKILL após 6s como último recurso).
 */
export function startDownload({ url, output, headers = {}, modeIndex = 0, onProgress, extraArgs = [] }) {
  const mode = MODES[modeIndex] || MODES[0];
  const headerStr = formatHeaders(headers);

  const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y'];
  if (headerStr) args.push('-headers', headerStr);
  // extraArgs (ex.: ['-allowed_extensions', 'ALL']) entram antes do -i,
  // pois são opções de entrada do demuxer HLS.
  args.push(...extraArgs, '-i', url, '-progress', 'pipe:1', ...mode.args, output);

  let child;
  try {
    child = spawn(getFfmpegCommand(), args, { windowsHide: true });
  } catch (err) {
    return {
      promise: Promise.resolve({ ok: false, code: -1, error: err, stderr: '', interrupted: false }),
      stop: () => {},
    };
  }

  let stderr = '';
  let buf = '';
  let interrupted = false;

  // Saída de progresso do FFmpeg (-progress pipe:1) no formato chave=valor.
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      const eq = line.indexOf('=');
      if (eq > 0 && onProgress) onProgress({ key: line.slice(0, eq), value: line.slice(eq + 1) });
    }
  });

  child.stderr.on('data', (d) => {
    stderr = (stderr + d.toString()).slice(-60000);
  });

  const stop = () => {
    interrupted = true;
    try {
      if (child.stdin && child.stdin.writable) child.stdin.write('q');
    } catch {
      /* ignora */
    }
    const killer = setTimeout(() => {
      try {
        if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
      } catch {
        /* ignora */
      }
    }, 6000);
    killer.unref();
  };

  const promise = new Promise((resolve) => {
    child.on('error', (err) => resolve({ ok: false, code: -1, error: err, stderr, interrupted }));
    child.on('close', (code) => resolve({ ok: code === 0 && !interrupted, code, stderr, interrupted }));
  });

  return { promise, stop, mode };
}
