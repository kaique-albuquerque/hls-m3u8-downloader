/**
 * P2.4/P2.5 — StreamGrabCore (fachada pública) — src/core/registry.js
 *
 * Fachada consumível por CLI, Electron e harness de teste com a MESMA API:
 *   analyze, enqueue, download, pause, resume, cancel, getQueue, getHistory.
 *
 * Criterios do plano:
 *  - NAO importa nada de `cli/` nem de `electron/`.
 *  - Delega inicialmente aos adapters existentes (src/source-adapters.js,
 *    src/ffmpeg.js, src/utils.js — todos na raiz de src/).
 *  - Emite eventos da P2.3 (start/progress/speed/eta/pause/resume/complete/
 *    error/cancel) com payload padronizado.
 *  - Estado do job transicionado via src/core/models.js (P2.1).
 *
 * A partir da P2.5, a EXECUCAO do ciclo de vida (analyzing -> preparing ->
 * downloading -> completed/failed/cancelled, pausa/retomada/cancelamento,
 * fila e historico) e delegada ao DownloadEngine (src/core/engine.js). Esta
 * fachada mantem apenas: resolucao de adapter + normalize MediaInfo (analyze)
 * e o roteamento das chamadas publicas para o engine.
 */

import { createEventBus } from './events.js';
import { createMediaInfo } from './models.js';
import { DownloadEngine, createDefaultExecutor } from './engine.js';

export { createDefaultExecutor };

/**
 * Fachada publica StreamGrabCore.
 *
 * Opcoes:
 *  - events: event bus da P2.3 (default: novo)
 *  - executor: transporte injetavel (default: createDefaultExecutor())
 *  - progressThrottleMs: intervalo minimo entre eventos de progresso
 *  - resolveAdapter: deteccao de fonte (default: defaultResolveAdapter)
 *  - settings/disk/history/atomic: colaboradores P7 (opcionais, injetados no
 *    DownloadEngine — sem mudar o comportamento quando ausentes)
 *  - engine: DownloadEngine injetavel (P11/Eletron) — quando fornecido, a
 *    fachada usa essa instancia em vez de criar uma nova (permite que o
 *    Electron compartilhe o mesmo engine com a DownloadQueue).
 */
export class StreamGrabCore {
  constructor({ events = createEventBus(), executor = createDefaultExecutor(), progressThrottleMs = 80, resolveAdapter, settings, disk, history, atomic, engine } = {}) {
    this.events = engine ? engine.events || events : events;
    this._engine = engine || new DownloadEngine({ events, executor, progressThrottleMs, resolveAdapter, settings, disk, history, atomic });
  }

  // -- eventos --------------------------------------------------------------

  on(name, handler) {
    return this.events.on(name, handler);
  }

  once(name, handler) {
    return this.events.once(name, handler);
  }

  off(name, handler) {
    return this.events.off(name, handler);
  }

  // -- analyze --------------------------------------------------------------

  /**
   * Analisa a URL delegando ao adapter existente. Retorna
   * { adapter, info } onde info e um MediaInfo normalizado (P2.1).
   */
  async analyze(url, { headers, auth, forceYouTube } = {}) {
    const adapter = await this._engine.resolveAdapter(url, { headers, auth, forceYouTube });
    if (adapter.id === 'unknown') {
      const err = new Error('Fonte nao suportada. Use HLS (.m3u8), DASH (.mpd), midia direta ou URL do YouTube/redes sociais.');
      err.code = 'UNSUPPORTED_SOURCE';
      throw err;
    }
    const raw = await this._engine.executor.analyze(adapter, { url, headers, auth });
    const info = createMediaInfo({ ...raw, sourceType: adapter.id, provider: adapter.id });
    return { adapter, info };
  }

  // -- fila / execucao (delegadas ao DownloadEngine) ------------------------

  enqueue(url, opts) {
    return this._engine.enqueue(url, opts);
  }

  getJob(id) {
    return this._engine.getJob(id);
  }

  getQueue() {
    return this._engine.getQueue();
  }

  getHistory() {
    return this._engine.getHistory();
  }

  download(target, opts) {
    return this._engine.run(target, opts);
  }

  pause(id) {
    return this._engine.pause(id);
  }

  resume(id) {
    return this._engine.resume(id);
  }

  cancel(id) {
    return this._engine.cancel(id);
  }

  remove(id) {
    return this._engine.remove(id);
  }

  dispose() {
    return this._engine.dispose();
  }
}

/** Factory de conveniencia. */
export function createStreamGrabCore(opts) {
  return new StreamGrabCore(opts);
}

export default StreamGrabCore;
