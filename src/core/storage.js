/**
 * P7 — Persistencia JSON atomica (src/core/storage.js)
 *
 * Seção 46 do architect.md: JSON + escrita atomica (aprovado; SQLite so seria
 * reavaliado com necessidade real). Garantias:
 *  - escrita sempre via arquivo temporario + rename (crash no meio nunca
 *    corrompe o arquivo anterior);
 *  - schema versionado (`{ version: 1 }`): na leitura, campos desconhecidos
 *    (de uma versao futura) sao preservados apenas quando a versao e
 *    compativel; versao desconhecida -> defaults + merge tolerante
 *    (downgrade ignora campos novos);
 *  - arquivo corrompido/ilegivel nunca derruba o app: retorna defaults.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Caminho temporario usado na escrita atomica (mesmo diretorio -> mesmo volume). */
export function tmpPathFor(file) {
  return `${file}.tmp`;
}

/**
 * Escreve `data` em `file` de forma atomica: grava em `file.tmp`, fecha e
 * renomeia por cima. Se o processo morrer no meio, o arquivo original fica
 * intacto (apenas um `.tmp` orfao, que a proxima escrita sobrescreve).
 */
export function atomicWriteFileSync(file, data) {
  const tmp = tmpPathFor(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

/** Le JSON retornando `null` se o arquivo nao existir ou estiver corrompido. */
export function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Cria um store JSON versionado com defaults.
 *
 * Opcoes:
 *  - file: caminho do arquivo persistido
 *  - version: versao do schema (default 1)
 *  - defaults: objeto base (deep merge aplicado sempre)
 *
 * API: load() / save(data) / set(data) / get() / exists().
 */
export function createJsonStore({ file, version = 1, defaults = {} } = {}) {
  if (!file) throw new TypeError('createJsonStore: file e obrigatorio');
  let _data = null; // cache: null = ainda nao carregado

  function normalize(raw) {
    const base = structuredClone(defaults);
    if (raw === null || typeof raw !== 'object') return { ...base, version };
    // Merge tolerante: campos conhecidos (do default) prevalecem do arquivo;
    // campos desconhecidos so entram se a versao for <= a atual (schema futuro
    // nao e lido por binarios antigos).
    const rawVersion = Number(raw.version || 0);
    const merged = { ...base };
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'version') continue;
      if (k in base) {
        if (v !== undefined) merged[k] = v;
      } else if (rawVersion > 0 && rawVersion <= version) {
        merged[k] = v; // campo novo de versao <= atual: preserva
      }
      // versao futura com campo desconhecido: ignora (downgrade seguro)
    }
    merged.version = version;
    return merged;
  }

  return {
    file,
    version,

    /** Carrega do disco (cache). Corrompido/ausente -> defaults. */
    load() {
      const raw = readJsonSafe(file);
      _data = normalize(raw);
      return this.get();
    },

    /** Dados em cache (load() implicito na primeira chamada). */
    get() {
      if (_data === null) this.load();
      return structuredClone(_data);
    },

    /** Salva `data` atomico (deep-merge sobre defaults/estado atual). */
    save(data) {
      const current = this.get();
      _data = normalize({ ...current, ...data });
      atomicWriteFileSync(file, JSON.stringify(_data, null, 2));
      return this.get();
    },

    /** Alias de save(). */
    set(data) {
      return this.save(data);
    },

    exists() {
      return fs.existsSync(file);
    },
  };
}
