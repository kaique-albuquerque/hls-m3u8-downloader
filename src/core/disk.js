/**
 * P7 — Checagem de disco (src/core/disk.js)
 *
 * Seção 8 do architect.md: verificar espaço disponivel antes de downloads
 * grandes (incluindo temporario extra para mux). `fs.statfs` (Node >= 18.15)
 * retorna bytes livres; se indisponivel (plataforma/erro), a checagem e
 * ignorada (null) — nunca bloqueia o download por falta de metrica.
 *
 * DiskSpaceError ja existe em errors.js (P2.2) e e classificado
 * automaticamente por classifyError.
 */

import fs from 'node:fs';

/**
 * Bytes livres no diretorio (ou null se nao for possivel medir).
 * Usa statfs: espaco disponivel para o usuario (`bavail * bsize`).
 */
export async function getFreeBytes(dir) {
  try {
    const st = await fs.promises.statfs(dir);
    if (st && typeof st.bavail === 'bigint' && typeof st.bsize === 'bigint') {
      return Number(st.bavail * st.bsize);
    }
    if (st && typeof st.bavail === 'number' && typeof st.bsize === 'number') {
      return st.bavail * st.bsize;
    }
    return null;
  } catch {
    return null;
  }
}

/** Estimativa de espaco extra temporario para mux (video + audio + saida). */
export function estimateMuxSpace(mediaBytes) {
  return Math.ceil(mediaBytes * 2.2) + 50 * 1024 * 1024; // margem fixa de 50MB
}

/**
 * Verifica se ha espaco para `requiredBytes` em `dir` (+ extraBytes).
 * Lanca DiskSpaceError (amigavel) quando insuficiente; retorna true se nao
 * for possivel medir (free === null) ou houver espaco.
 */
export async function checkDiskSpace({ dir, requiredBytes, extraBytes = 0 }) {
  const free = await getFreeBytes(dir);
  if (free === null) return true; // nao medivel: nao bloqueia
  const need = Number(requiredBytes || 0) + Number(extraBytes || 0);
  if (need > 0 && free < need) {
    const { DiskSpaceError } = await import('./errors.js');
    const missing = Math.ceil((need - free) / (1024 * 1024));
    throw new DiskSpaceError(`Espaco em disco insuficiente (faltam ~${missing} MB).`, {
      detail: `Disponivel: ${free} bytes; necessario: ${need} bytes (incl. temporarios).`,
    });
  }
  return true;
}
