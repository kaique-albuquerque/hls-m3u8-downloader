/**
 * P7 — DownloadQueue (src/core/queue.js)
 *
 * Seção 10 do architect.md. Orquestra o DownloadEngine (P2.5) com:
 *  - limite de downloads simultaneos (maxConcurrent);
 *  - auto-start: enfileirou -> processa ate o limite;
 *  - cancelar / pausar / retomar / tentar de novo (retry) / remover /
 *    reordenar;
 *  - abrir arquivo/pasta: aqui expomos o caminho final (getOutputPath) — a
 *    abertura em si e da UI (core nao importa Electron);
 *  - persistencia opcional (storage) com crash recovery: jobs em andamento
 *    sao revalidados como `queued` ao restaurar.
 *
 * A ordem dos jobs e mantida pela propria fila (`_order`), independente do
 * Map do engine, permitindo reordenacao sem tocar no engine.
 */

import { createJsonStore } from './storage.js';

/** Estados que a fila considera "em andamento" (nao podem ser reordenados). */
const RUNNING_STATES = new Set(['analyzing', 'preparing', 'downloading', 'paused', 'merging']);
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

function isNonTerminal(job) {
  return job && !TERMINAL_STATES.has(job.state);
}

/**
 * Cria a fila de downloads.
 *
 * Opcoes:
 *  - engine: DownloadEngine (obrigatorio)
 *  - maxConcurrent: limite de simultaneos (default 3)
 *  - storage: store JSON opcional para persistir a fila (crash recovery)
 *  - autoStart: comeca a processar automaticamente ao enfileirar (default true)
 *  - onEvent: callback opcional (event, payload) para a UI observar a fila
 */
export function createDownloadQueue({ engine, maxConcurrent = 3, storage = null, autoStart = true, onEvent = null } = {}) {
  if (!engine) throw new TypeError('createDownloadQueue: engine e obrigatorio');
  maxConcurrent = Number(maxConcurrent);
  if (!Number.isFinite(maxConcurrent)) maxConcurrent = 3;
  maxConcurrent = Math.min(16, Math.max(1, maxConcurrent));

  const _started = new Set(); // ids de jobs ja entregues ao engine.run
  const _running = new Map(); // id -> Promise<job>
  const _order = []; // ids em ordem de fila
  let _draining = false;
  let _pumpScheduled = false;
  let _paused = false;

  const emit = (event, payload) => {
    if (typeof onEvent === 'function') onEvent(event, payload);
  };

  function seedOrder() {
    if (_order.length === 0) {
      for (const job of engine.getQueue()) _order.push(job.id);
    }
  }

  function orderedJobs() {
    seedOrder();
    const byId = new Map(engine.getQueue().map((j) => [j.id, j]));
    const out = [];
    for (const id of _order) {
      if (byId.has(id)) out.push(byId.get(id));
    }
    // jobs que existem no engine mas nao na ordem (importados por restauracao)
    for (const [id, job] of byId) {
      if (!_order.includes(id)) out.push(job);
    }
    return out;
  }

  const engineOffs = [];
  function subscribeEngine() {
    for (const event of ['complete', 'error', 'cancel']) {
      const handler = (payload) => {
        _running.delete(payload?.jobId);
        emit(event, payload);
        if (!_paused) _pump();
      };
      engine.on(event, handler);
      engineOffs.push(() => engine.off(event, handler));
    }
  }
  subscribeEngine();

  /** Inicia o proximo job `queued` na ordem, respeitando o limite. */
  async function _pump() {
    // P1.4: usa queueMicrotask para evitar race condition — chamadas
    // concurrentes sao coalescidas em um unico pump na proxima microtask.
    if (_pumpScheduled) return;
    _pumpScheduled = true;
    queueMicrotask(async () => {
      _pumpScheduled = false;
      if (_draining) return;
      _draining = true;
      try {
        while (!_paused && _running.size < maxConcurrent) {
          const job = orderedJobs().find((j) => j.state === 'queued' && !_started.has(j.id));
          if (!job) break;
          _started.add(job.id);
          // P11: propaga as opcoes por-job guardadas em meta (pasta de saida,
          // formato escolhido, headers/auth) para o engine — a UI nao depende
          // mais da simulacao de prompts do CLI para definir o destino.
          const runOpts = {
            destination: job.meta?.destination || undefined,
            selectedUrl: job.meta?.selectedUrl || undefined,
            headers: job.meta?.headers || undefined,
            auth: job.meta?.auth || undefined,
            mode: job.meta?.mode || undefined,
            // P12.1: audio/subtitle selections from meta
            audioLanguage: job.meta?.audioLanguage || undefined,
            allAudio: job.meta?.allAudio || false,
          };
          const p = engine
            .run(job.id, runOpts)
            .catch(() => {}) // estado terminal ja registrado via eventos
            .finally(() => _running.delete(job.id));
          _running.set(job.id, p);
          emit('started', job);
        }
      } finally {
        _draining = false;
      }
    });
  }

  return {
    engine,
    get maxConcurrent() {
      return maxConcurrent;
    },

    /** Ajusta o limite de downloads simultaneos em tempo de execucao. */
    setMaxConcurrent(n) {
      const value = Number(n);
      if (!Number.isFinite(value)) return maxConcurrent;
      maxConcurrent = Math.min(16, Math.max(1, value));
      if (autoStart && !_paused) _pump();
      return maxConcurrent;
    },

    /** True quando o processamento da fila esta pausado como um todo. */
    get paused() {
      return _paused;
    },

    /** Jobs nao terminais, na ordem da fila. */
    list() {
      return orderedJobs().filter(isNonTerminal);
    },

    /**
     * Todos os jobs (incluindo terminais) na ordem da fila — usado pela UI
     * para oferecer retry/remove de jobs concluidos/falhos/cancelados.
     */
    all() {
      return orderedJobs().map((j) => ({ ...j, meta: { ...j.meta } }));
    },

    get(id) {
      return engine.getJob(id);
    },

    getOutputPath(id) {
      return engine.getJob(id)?.meta?.output || '';
    },

    /** Enfileira e (por padrao) inicia o processamento. */
    enqueue(url, opts = {}) {
      const job = engine.enqueue(url, opts);
      _order.push(job.id);
      if (autoStart && !_paused) _pump();
      return job;
    },

    pause(id) {
      return engine.pause(id);
    },

    resume(id) {
      return engine.resume(id);
    },

    cancel(id) {
      return engine.cancel(id);
    },

    /** Pausa/retoma o processamento da fila como um todo. */
    setPaused(value) {
      _paused = Boolean(value);
      if (!_paused) _pump();
    },

    /**
     * Tenta de novo um job terminal: re-enfileira a mesma URL como um job
     * novo `queued` (o antigo permanece no historico). Retorna o novo job.
     */
    retry(id) {
      const job = engine.getJob(id);
      if (!job) {
        const err = new Error(`Job nao encontrado: ${id}`);
        err.code = 'JOB_NOT_FOUND';
        throw err;
      }
      if (!TERMINAL_STATES.has(job.state)) return job; // ainda nao terminou
      return this.enqueue(job.url, { title: job.title, meta: { ...job.meta, retryOf: job.id } });
    },

    /** Remove um job da fila (cancela se estiver ativo; remove do historico). */
    remove(id) {
      const job = engine.getJob(id);
      if (!job) {
        const err = new Error(`Job nao encontrado: ${id}`);
        err.code = 'JOB_NOT_FOUND';
        throw err;
      }
      if (!TERMINAL_STATES.has(job.state)) engine.cancel(id);
      engine.remove(id);
      const idx = _order.indexOf(job.id);
      if (idx !== -1) _order.splice(idx, 1);
      _started.delete(job.id);
      _running.delete(job.id);
      return this;
    },

    /** Reordena a fila (indices da lista atual). Sem efeito em jobs ativos. */
    reorder(fromIndex, toIndex) {
      seedOrder();
      const jobs = orderedJobs();
      const active = jobs.filter((j) => RUNNING_STATES.has(j.state));
      if (active.length > 0) {
        const err = new Error('Nao e possivel reordenar com downloads em andamento.');
        err.code = 'QUEUE_BUSY';
        throw err;
      }
      const ids = jobs.map((j) => j.id);
      if (fromIndex < 0 || fromIndex >= ids.length || toIndex < 0 || toIndex >= ids.length) {
        const err = new Error(`Indices invalidos: ${fromIndex} -> ${toIndex}`);
        err.code = 'INVALID_INDEX';
        throw err;
      }
      const [moved] = ids.splice(fromIndex, 1);
      ids.splice(toIndex, 0, moved);
      _order.length = 0;
      _order.push(...ids);
      return this.list();
    },

    // -- persistencia / crash recovery --------------------------------------

    /**
     * Snapshot da fila (jobs nao terminais) para persistir.
     * Nao inclui estado de execucao: ao restaurar, tudo vira `queued`.
     */
    snapshot() {
      return orderedJobs()
        .filter(isNonTerminal)
        .map((j) => ({ id: j.id, url: j.url, title: j.title, meta: j.meta }));
    },

    /** Restaura um snapshot: jobs em andamento sao revalidados como queued. */
    restore(snapshot) {
      if (!Array.isArray(snapshot)) return this;
      for (const item of snapshot) {
        if (!item || !item.url) continue;
        const job = engine.enqueue(item.url, {
          id: item.id,
          title: item.title || '',
          meta: { ...(item.meta || {}), recovered: true },
        });
        _order.push(job.id);
      }
      return this;
    },

    /** Persiste o snapshot se um storage foi fornecido. */
    save() {
      if (!storage) return null;
      storage.save({ jobs: this.snapshot() });
      return storage.get();
    },

    /** Restaura do storage persistido (se houver) e retoma o processamento. */
    async load() {
      if (!storage) return this;
      const data = storage.get();
      this.restore(Array.isArray(data?.jobs) ? data.jobs : []);
      if (autoStart && !_paused) _pump();
      return this;
    },

    dispose() {
      for (const off of engineOffs) off();
      _order.length = 0;
      _running.clear();
      _started.clear();
    },
  };
}

export function createDefaultQueueStorage({ file }) {
  return createJsonStore({ file, version: 1, defaults: { jobs: [] } });
}
