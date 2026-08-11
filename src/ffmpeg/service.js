/**
 * P5 — FfmpegService (src/ffmpeg/service.js)
 *
 * Centraliza a interação com o FFmpeg:
 *  - detecção do binário (vendor/ffmpeg ou PATH);
 *  - execução de processos (nunca via exec/string — sempre spawn com args);
 *  - progresso via eventos (-progress pipe:1 → onProgress({ key, value }));
 *  - cancelamento (stop() gracioso com 'q' + SIGKILL após 6s como último
 *    recurso) e suporte a AbortSignal;
 *  - cleanup de listeners (sem vazamento por download).
 *
 * Nenhum comando específico de remux/mux/áudio mora aqui — isso é
 * responsabilidade de muxer.js/audio.js (evita duplicação de comandos FFmpeg
 * entre providers, seção 20 do architect.md).
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor', 'ffmpeg');
const BIN_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const BIN_PATH = path.join(VENDOR_DIR, BIN_NAME);
const INSTALLED_MARKER = path.join(VENDOR_DIR, '.installed');

function isLocalFfmpegReady() {
  return fs.existsSync(BIN_PATH) && fs.existsSync(INSTALLED_MARKER);
}

/**
 * Caminho do FFmpeg local (instalado por scripts/install-ffmpeg.mjs em
 * vendor/ffmpeg/). Se não existir, usa o comando 'ffmpeg' do PATH.
 */
export function getFfmpegCommand() {
  if (isLocalFfmpegReady()) return BIN_PATH;
  return 'ffmpeg';
}

/**
 * Verifica se o FFmpeg está disponível (local em vendor/ffmpeg ou no PATH).
 * Retorna true/false (nunca lança exceção).
 */
export async function checkFfmpeg() {
  try {
    const cmd = getFfmpegCommand();
    const r = spawnSync(cmd, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    return r.status === 0 && /ffmpeg version/i.test(out);
  } catch {
    return false;
  }
}

/**
 * Serviço central de execução do FFmpeg.
 *
 * `spawnFn` e `getCommand` são injetáveis para testes unitários
 * determinísticos (sem binário real).
 */
export class FfmpegService {
  constructor({ getCommand = getFfmpegCommand, spawnFn = spawn } = {}) {
    this._getCommand = getCommand;
    this._spawnFn = spawnFn;
  }

  /** Idêntico a checkFfmpeg() (conveniência de instância). */
  async check() {
    return checkFfmpeg();
  }

  /**
   * Executa o FFmpeg com `args` (array — nunca string montada com entrada
   * do usuário). Progresso via `onProgress({ key, value })` com os campos
   * do `-progress pipe:1`. `signal` (AbortSignal opcional) interrompe o
   * processo.
   *
   * Retorna { promise, stop, child }:
   *  - promise resolve com { ok, code, stderr, interrupted, error? }
   *  - stop() encerra de forma graciosa (escreve 'q' no stdin e força
   *    SIGKILL após 6s como último recurso).
   */
  run({ args, onProgress, signal }) {
    let child;
    try {
      child = this._spawnFn(this._getCommand(), args, { windowsHide: true });
    } catch (err) {
      return {
        promise: Promise.resolve({ ok: false, code: -1, error: err, stderr: '', interrupted: false }),
        stop: () => {},
        child: null,
      };
    }

    let stderr = '';
    let buf = '';
    let interrupted = false;

    const progressCb = typeof onProgress === 'function' ? onProgress : null;
    child.stdout?.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const eq = line.indexOf('=');
        if (eq > 0 && progressCb) progressCb({ key: line.slice(0, eq), value: line.slice(eq + 1) });
      }
    });

    child.stderr?.on('data', (d) => {
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

    const onAbort = () => stop();
    let removeAbort = null;
    if (signal) {
      if (signal.aborted) {
        stop();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbort = () => signal.removeEventListener('abort', onAbort);
      }
    }

    const done = (result) => {
      removeAbort?.();
      return result;
    };

    const promise = new Promise((resolve) => {
      child.on('error', (err) => resolve(done({ ok: false, code: -1, error: err, stderr, interrupted })));
      child.on('close', (code) => resolve(done({ ok: code === 0 && !interrupted, code, stderr, interrupted })));
    });

    return { promise, stop, child };
  }
}

/** Instância padrão compartilhada (spawn real). */
export const ffmpegService = new FfmpegService();
