/**
 * P7 — Download atomico (.part + rename) — src/core/atomic.js
 *
 * Seção 8 do architect.md: download em `.part` com rename somente apos
 * validacao. Primitivas usadas pelos transports/fluxos que controlam o
 * arquivo por stream (HTTP direto); o FFmpeg (HLS/DASH/mux) continua
 * escrevendo no destino final — para esses, "resume/atômico" e re-execucao
 * (P6.1, fora de escopo aqui).
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Cria um arquivo parcial atomico.
 *
 * Opcoes:
 *  - dir: diretorio de destino
 *  - filename: nome final (o parcial usa `filename.part` no mesmo diretorio —
 *    mesmo volume, rename atomico)
 *  - fsImpl: injetavel p/ testes (default fs)
 *
 * API: write(data), commit() (rename .part -> final), abort() (remove .part),
 * paths (partPath/finalPath), exists().
 */
export function createAtomicFile({ dir, filename, fsImpl = fs } = {}) {
  if (!dir || !filename) throw new TypeError('createAtomicFile: dir e filename sao obrigatorios');
  const finalPath = path.join(dir, filename);
  const partPath = `${finalPath}.part`;
  let committed = false;

  return {
    partPath,
    finalPath,

    exists() {
      return fsImpl.existsSync(partPath);
    },

    async write(data) {
      await fsImpl.promises.mkdir(dir, { recursive: true });
      await fsImpl.promises.appendFile(partPath, data);
      return this;
    },

    /** Valida (existe e nao vazio) e renomeia para o nome final. */
    async commit() {
      if (committed) return finalPath;
      const st = await fsImpl.promises.stat(partPath).catch(() => null);
      if (!st || st.size === 0) {
        const err = new Error(`Arquivo parcial vazio ou ausente: ${partPath}`);
        err.code = 'EMPTY_PARTIAL';
        throw err;
      }
      await fsImpl.promises.rename(partPath, finalPath);
      committed = true;
      return finalPath;
    },

    async abort() {
      await fsImpl.promises.unlink(partPath).catch(() => {});
      return this;
    },
  };
}

/** Move um `.part` (ja validado) para o destino final. Sincrono. */
export function moveIntoPlace(partPath, finalPath) {
  if (!fs.existsSync(partPath)) {
    const err = new Error(`Arquivo parcial nao encontrado: ${partPath}`);
    err.code = 'PARTIAL_NOT_FOUND';
    throw err;
  }
  const st = fs.statSync(partPath);
  if (st.size === 0) {
    const err = new Error(`Arquivo parcial vazio: ${partPath}`);
    err.code = 'EMPTY_PARTIAL';
    throw err;
  }
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.renameSync(partPath, finalPath);
  return finalPath;
}

/** Remove um `.part` (ignorando ausencia). */
export function cleanupPart(partPath) {
  try {
    if (partPath && fs.existsSync(partPath)) fs.unlinkSync(partPath);
  } catch {
    /* ignora */
  }
}
