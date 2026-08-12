/**
 * P7 — Settings persistidos (src/core/settings.js)
 *
 * Seção 22 do architect.md. Opcoes de usuario persistidas em JSON atomico
 * (storage.js). Regras:
 *  - apenas chaves conhecidas sao aceitas (typos nao corrompem o arquivo);
 *  - valores passam por coerção de tipo e limites (clamp);
 *  - `reset()` restaura os defaults.
 *
 * Nota de privacidade: settings nao contem URLs/cookies — apenas preferencias.
 */

import { createJsonStore } from './storage.js';

/** Defaults de configuração. `defaultDir: ''` = diretorio do sistema. */
export const DEFAULT_SETTINGS = Object.freeze({
  defaultDir: '',
  maxConcurrentDownloads: 3,
  turbo: false,
  turboChunks: 8,
  defaultQuality: 'best',
  audio: 'original',
  notifications: true,
  theme: 'system',
  onComplete: '',
  historyRetentionDays: 0, // 0 = manter para sempre
});

const SCHEMA = {
  defaultDir: { type: 'string', clamp: null },
  maxConcurrentDownloads: { type: 'number', clamp: [1, 16] },
  turbo: { type: 'boolean', clamp: null },
  turboChunks: { type: 'number', clamp: [1, 32] },
  defaultQuality: { type: 'string', clamp: null },
  audio: { type: 'string', clamp: null },
  notifications: { type: 'boolean', clamp: null },
  theme: { type: 'string', clamp: null },
  onComplete: { type: 'string', clamp: null },
  historyRetentionDays: { type: 'number', clamp: [0, 3650] },
};

function coerce(key, value, current) {
  const spec = SCHEMA[key];
  if (!spec) return undefined; // chave desconhecida: ignorada
  let out = value;
  if (spec.type === 'number') {
    out = Number(value);
    if (!Number.isFinite(out)) return current; // NaN -> mantem atual
    if (spec.clamp) out = Math.min(spec.clamp[1], Math.max(spec.clamp[0], out));
  } else if (spec.type === 'boolean') {
    out = Boolean(value);
  } else {
    out = String(value);
  }
  return out;
}

/**
 * Normaliza um objeto cru contra o schema: ignora chaves desconhecidas,
 * coage tipos e aplica clamps. Retorna um objeto somente com chaves validas.
 */
export function normalizeSettings(raw = {}) {
  if (raw === null || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'version') continue;
    const coerced = coerce(k, v, DEFAULT_SETTINGS[k]);
    if (coerced !== undefined) out[k] = coerced;
  }
  return out;
}

/**
 * Cria o store de settings persistidos.
 *
 * Opcoes: file (obrigatorio), defaults (opcional, default DEFAULT_SETTINGS),
 * storage (opcional, injetavel p/ testes).
 */
export function createSettingsStore({ file, defaults = DEFAULT_SETTINGS, storage } = {}) {
  if (!file && !storage) throw new TypeError('createSettingsStore: file e obrigatorio');
  const store = storage || createJsonStore({ file, version: 1, defaults });
  store.load();

  return {
    file: store.file,
    store,

    /** Todos os settings (clone). */
    all() {
      const rest = { ...store.get() };
      delete rest.version;
      return rest;
    },

    /** Valor de uma chave (default se ausente). */
    get(key) {
      const data = store.get();
      return key in data ? data[key] : defaults[key];
    },

    /** Define uma chave (validada) e persiste. */
    set(key, value) {
      const current = this.all();
      const coerced = coerce(key, value, current[key]);
      if (coerced === undefined) return this.get(key); // desconhecida: no-op
      store.save({ ...current, [key]: coerced });
      return this.get(key);
    },

    /** Aplica varias chaves de uma vez. */
    update(partial = {}) {
      const current = this.all();
      const next = { ...current };
      for (const [k, v] of Object.entries(partial)) {
        const coerced = coerce(k, v, current[k]);
        if (coerced !== undefined) next[k] = coerced;
      }
      store.save(next);
      return this.all();
    },

    /** Restaura os defaults e persiste. */
    reset() {
      store.save({ ...defaults });
      return this.all();
    },
  };
}
