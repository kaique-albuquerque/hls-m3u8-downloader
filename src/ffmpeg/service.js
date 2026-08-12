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
import { binName, getPackagedResourcesPath } from '../core/binaries.js';
import { sleep } from '../core/retry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor', 'ffmpeg');
const BIN_NAME = binName('ffmpeg');
const BIN_PATH = path.join(VENDOR_DIR, BIN_NAME);
const INSTALLED_MARKER = path.join(VENDOR_DIR, '.installed');

function isLocalFfmpegReady() {
  return fs.existsSync(BIN_PATH) && fs.existsSync(INSTALLED_MARKER);
}

/** Caminho do FFmpeg empacotado (extraResources/bin) ou ''. */
function packagedFfmpegPath() {
  const root = getPackagedResourcesPath();
  return root ? path.join(root, 'bin', BIN_NAME) : '';
}

/**
 * Caminho do FFmpeg: empacotado (produção, extraResources/bin) > local
 * (instalado por scripts/install-ffmpeg.mjs em vendor/ffmpeg/) > PATH.
 */
export function getFfmpegCommand() {
  const packaged = packagedFfmpegPath();
  if (packaged && fs.existsSync(packaged)) return packaged;
  if (isLocalFfmpegReady()) return BIN_PATH;
  return 'ffmpeg';
}

/**
 * Verifica se o FFmpeg está disponível (empacotado > vendor/ffmpeg > PATH).
 * Retorna true/false (nunca lança exceção).
 *
 * P10: com retry — na 1ª execução de um binário recém-instalado o Windows
 * (Defender/SmartScreen) pode segurar ou bloquear o spawn (EPERM/access
 * denied) por alguns segundos; tentativa única gerava falsos "FFmpeg nao
 * encontrado" no app empacotado. O motivo real da última falha é logado
 * (antes o catch engolia tudo).
 */
export async function checkFfmpeg({ retries = 3, retryDelayMs = 1500 } = {}) {
  let lastReason = '';
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const cmd = getFfmpegCommand();
      const r = spawnSync(cmd, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
      const out = `${r.stdout || ''}\n${r.stderr || ''}`;
      if (r.status === 0 && /ffmpeg version/i.test(out)) return true;
      lastReason = `status=${r.status}${r.error ? ` error=${r.error.message}` : ''}`;
    } catch (err) {
      lastReason = err?.message || String(err);
    }
    if (attempt < retries) await sleep(retryDelayMs);
  }
  console.error(`[ffmpeg] checkFfmpeg falhou apos ${retries} tentativas: ${lastReason}`);
  return false;
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
