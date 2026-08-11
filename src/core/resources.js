/**
 * P4 — Limites de recursos (plano §16 / §41).
 *
 * Controla quantos recursos simultaneos o StreamGrab pode usar:
 *  - downloads simultaneos (semaforo global)
 *  - conexoes por download (usado pelo transporte Range / turbo)
 *  - processos FFmpeg simultaneos
 *  - diretorios temporarios ativos
 *
 * Uso tipico:
 *   const limiter = createDefaultResourceManager();
 *   const release = await limiter.acquireDownload();
 *   try { ... } finally { release(); }
 */

/** Semafaro classico com suporte a cancelamento via AbortSignal. */
export class Semaphore {
  /**
   * @param {number} max — limite de recursos concorrentes (>= 1).
   */
  constructor(max = 1) {
    if (!Number.isFinite(max) || max < 1) {
      throw new TypeError(`Semaphore: max deve ser um inteiro >= 1 (recebido ${max})`);
    }
    this._max = Math.floor(max);
    this._active = 0;
    this._queue = [];
  }

  /** Quantos recursos estao em uso agora. */
  get active() {
    return this._active;
  }

  /** Quantos recursos ainda podem ser adquiridos sem esperar. */
  get available() {
    return Math.max(0, this._max - this._active);
  }

  get max() {
    return this._max;
  }

  /**
   * Adquire um slot. Resolve com uma funcao `release()`.
   * Se `signal` abortar enquanto espera na fila, rejeita com code CANCELLED.
   */
  acquire(signal) {
    if (this._active < this._max) {
      this._active += 1;
      return Promise.resolve(this._release.bind(this));
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, signal };
      const onAbort = () => {
        const idx = this._queue.indexOf(entry);
        if (idx >= 0) {
          this._queue.splice(idx, 1);
          const err = new Error('Operacao cancelada aguardando recurso.');
          err.code = 'CANCELLED';
          reject(err);
        }
      };
      entry.onAbort = onAbort;
      this._queue.push(entry);
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  _release() {
    this._active = Math.max(0, this._active - 1);
    const next = this._queue.shift();
    if (!next) return;
    this._active += 1;
    if (next.signal) {
      try {
        next.signal.removeEventListener('abort', next.onAbort);
      } catch {
        /* ignora */
      }
    }
    next.resolve?.(this._release.bind(this));
  }
}

/**
 * Gerenciador agregado de limites de recursos do StreamGrab.
 */
export class ResourceManager {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxConcurrentDownloads=3]
   * @param {number} [opts.maxConnectionsPerDownload=8]
   * @param {number} [opts.maxFfmpegProcesses=2]
   * @param {number} [opts.maxTempDirs=8]
   */
  constructor({
    maxConcurrentDownloads = 3,
    maxConnectionsPerDownload = 8,
    maxFfmpegProcesses = 2,
    maxTempDirs = 8,
  } = {}) {
    this.downloads = new Semaphore(maxConcurrentDownloads);
    this.connections = new Semaphore(maxConnectionsPerDownload);
    this.ffmpeg = new Semaphore(maxFfmpegProcesses);
    this.tempDirs = new Semaphore(maxTempDirs);
  }

  /** Snapshot legivel dos limites atuais. */
  get stats() {
    return {
      downloads: { active: this.downloads.active, available: this.downloads.available, max: this.downloads.max },
      connections: { active: this.connections.active, available: this.connections.available, max: this.connections.max },
      ffmpeg: { active: this.ffmpeg.active, available: this.ffmpeg.available, max: this.ffmpeg.max },
      tempDirs: { active: this.tempDirs.active, available: this.tempDirs.available, max: this.tempDirs.max },
    };
  }

  /** Adquire um slot de download simultaneo. Retorna funcao release. */
  acquireDownload(signal) {
    return this.downloads.acquire(signal);
  }

  /** Adquire um slot de conexao HTTP (usado por Range/turbo). */
  acquireConnection(signal) {
    return this.connections.acquire(signal);
  }

  /** Adquire um slot de processo FFmpeg. */
  acquireFfmpeg(signal) {
    return this.ffmpeg.acquire(signal);
  }

  /** Adquire um slot de diretorio temporario. */
  acquireTempDir(signal) {
    return this.tempDirs.acquire(signal);
  }
}

/** Factory de conveniencia. */
export function createDefaultResourceManager(opts) {
  return new ResourceManager(opts);
}

export default { ResourceManager, Semaphore, createDefaultResourceManager };
