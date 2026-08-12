/**
 * P11 — Servicos compartilhados do Electron (electron/services.js)
 *
 * Monta o grafo Core real, sem simulacao de prompts do CLI:
 *  - StreamGrabCore + DownloadEngine (item 1 do pedido P11): o Electron
 *    consome diretamente Core/Queue — `runCliSession()` + `createAnswerBook()`
 *    nao sao usados para downloads (itens 2, 9 e 12 do pedido).
 *  - DownloadQueue com persistencia real em queue.json (item 5): crash
 *    recovery — ao reiniciar o app, jobs em andamento voltam como `queued`.
 *  - Settings e History persistidos em settings.json / history.json (itens
 *    3, 4 e 5): a interface Electron integra as mesmas estruturas do CLI.
 *
 * Este modulo NAO importa electron/* (seguro para testes de integracao em
 * Node puro) e NAO importa cli-flow.js / createAnswerBook.
 */

import path from 'node:path';

import {
  DownloadEngine,
  createStreamGrabCore,
  createDownloadQueue,
  createDefaultQueueStorage,
  createSettingsStore,
  createHistoryStore,
  checkDiskSpace,
  createAtomicFile,
} from '../src/core/index.js';

/** Eventos que mudam o snapshot persistido da fila. */
const PERSIST_EVENTS = new Set(['started', 'complete', 'error', 'cancel']);

/**
 * Cria os servicos compartilhados do Electron.
 *
 * Opcoes:
 *  - userDataDir: pasta persistente do app (app.getPath('userData'))
 *  - onEvent: callback opcional (event, payload) observando a fila
 *
 * Retorna { core, queue, settings, history, queueStorage, dispose() }.
 */
export function createElectronServices({ userDataDir, onEvent = null } = {}) {
  if (!userDataDir || typeof userDataDir !== 'string') {
    throw new TypeError('createElectronServices: userDataDir e obrigatorio');
  }

  const settings = createSettingsStore({ file: path.join(userDataDir, 'settings.json') });
  const history = createHistoryStore({
    file: path.join(userDataDir, 'history.json'),
    retentionDays: Number(settings.get('historyRetentionDays')) || 0,
  });
  const queueStorage = createDefaultQueueStorage({ file: path.join(userDataDir, 'queue.json') });

  // Engine compartilhado: a fachada (StreamGrabCore) e a fila usam a MESMA
  // instancia — analise, enfileiramento e execucao compartilham estado/eventos.
  const engine = new DownloadEngine({
    settings,
    history,
    disk: { check: checkDiskSpace },
    atomic: { createAtomicFile },
  });
  const core = createStreamGrabCore({ engine });

  // A fila persiste o snapshot a cada mudanca de estado relevante
  // (crash recovery: reiniciou, jobs em andamento voltam como `queued`).
  let queueRef = null;
  const queue = createDownloadQueue({
    engine,
    maxConcurrent: settings.get('maxConcurrentDownloads'),
    storage: queueStorage,
    autoStart: true,
    onEvent: (event, payload) => {
      if (queueRef && PERSIST_EVENTS.has(event)) {
        try {
          queueRef.save();
        } catch {
          /* persistencia nunca derruba o fluxo */
        }
      }
      if (typeof onEvent === 'function') onEvent(event, payload);
    },
  });
  queueRef = queue;

  // Carrega estados persistidos de sessões anteriores (itens 3-5):
  // historico com retencao aplicada e fila com jobs recuperados.
  history.load();
  queue.load();

  return {
    core,
    queue,
    settings,
    history,
    queueStorage,
    userDataDir,

    /** Aplica `maxConcurrentDownloads` na fila em tempo de execucao. */
    applySettings(partial) {
      const updated = settings.update(partial);
      queue.setMaxConcurrent(updated.maxConcurrentDownloads);
      return updated;
    },

    dispose() {
      queue.dispose();
    },
  };
}
