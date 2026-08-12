/**
 * P7 — Historico local de downloads (src/core/history.js)
 *
 * Seção 21 do architect.md. Campos: titulo, URL original, provider, formato,
 * destino, data, status, tamanho, duracao. A UI pode abrir arquivo/pasta,
 * baixar de novo, copiar URL, remover ou limpar — aqui ficam as operacoes de
 * dados; "abrir" e responsabilidade da UI (core nao importa Electron).
 *
 * Privacidade: historico 100% local (JSON atomico) e controlavel pelo
 * usuario (remove/clear + retencao opcional em dias).
 */

import { createJsonStore } from './storage.js';

let historySequence = 0;

/** Normaliza uma entrada de historico (campos conhecidos, tipos seguros). */
export function createHistoryEntry({ id, title = '', url = '', provider = '', format = '', destination = '', status = 'completed', size = 0, durationMs = 0, date } = {}) {
  if (!url) throw new TypeError('createHistoryEntry: url e obrigatoria');
  historySequence += 1;
  return {
    id: String(id || `hist-${historySequence}`),
    title: String(title || ''),
    url: String(url),
    provider: String(provider || ''),
    format: String(format || ''),
    destination: String(destination || ''),
    status: String(status || 'completed'),
    size: Number(size) || 0,
    durationMs: Number(durationMs) || 0,
    date: date || new Date().toISOString(),
  };
}

/**
 * Cria o store de historico.
 *
 * Opcoes:
 *  - file: caminho do arquivo persistido
 *  - maxEntries: limite de entradas (0 = sem limite; trims no add)
 *  - retentionDays: >0 remove entradas mais antigas que N dias no load
 *  - storage: injetavel (testes)
 */
export function createHistoryStore({ file, maxEntries = 0, retentionDays = 0, storage } = {}) {
  if (!file && !storage) throw new TypeError('createHistoryStore: file e obrigatorio');
  const store = storage || createJsonStore({ file, version: 1, defaults: { entries: [] } });

  function normalizeEntries(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const now = Date.now();
    for (const e of raw) {
      if (!e || typeof e !== 'object' || !e.url) continue;
      if (retentionDays > 0) {
        const t = Date.parse(e.date || '');
        if (!Number.isFinite(t) || now - t > retentionDays * 24 * 3600 * 1000) continue;
      }
      out.push(createHistoryEntry({ ...e }));
    }
    return out;
  }

  function loadEntries() {
    const data = store.get();
    const entries = normalizeEntries(data.entries);
    if (entries.length !== (Array.isArray(data.entries) ? data.entries.length : 0)) {
      store.save({ entries }); // retencao removeu algo: persiste
    }
    return entries;
  }

  return {
    file: store.file,
    store,

    load() {
      loadEntries();
      return this;
    },

    /** Adiciona (no topo) e persiste. Retorna a entrada. */
    add(entry) {
      const normalized = createHistoryEntry(entry);
      const entries = loadEntries();
      entries.unshift(normalized);
      if (maxEntries > 0 && entries.length > maxEntries) entries.length = maxEntries;
      store.save({ entries });
      return normalized;
    },

    /** Lista mais recente primeiro. */
    list() {
      return loadEntries();
    },

    get(id) {
      return loadEntries().find((e) => e.id === String(id)) || null;
    },

    remove(id) {
      const entries = loadEntries().filter((e) => e.id !== String(id));
      store.save({ entries });
      return this;
    },

    clear() {
      store.save({ entries: [] });
      return this;
    },

    count() {
      return loadEntries().length;
    },
  };
}
