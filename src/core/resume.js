/**
 * P6.1 — Estado de resume de downloads (secao 13 do architect.md).
 *
 * Persiste o metadata de um download por partes (HTTP Range) em um arquivo
 * sidecar (`<destino>.resume.json`) com escrita atomica, para que uma
 * interrupcao possa ser retomada SEM re-baixar chunks ja concluidos.
 *
 * Garantias (plano §13):
 *  - Nunca concatena dados antigos se o recurso remoto mudou: `validateState`
 *    compara ETag/Last-Modified/tamanho com o probe atual; divergencia ->
 *    parcial descartado (download limpo).
 *  - Escrita atomica do state file (tmp + rename) — crash nunca deixa JSON
 *    corrompido; arquivo corrompido/versao errada -> tratado como ausente.
 *  - URL assinada expirada e tratada em `src/core/session.js` (reanalise).
 *
 * DownloadState:
 *   {
 *     version: 1,
 *     url, destination, totalSize,
 *     etag, lastModified,
 *     createdAt, updatedAt,
 *     chunks: [{ start, end, downloaded, completed }]
 *   }
 */

import fs from 'node:fs';
import path from 'node:path';

export const RESUME_STATE_VERSION = 1;

/** Caminho padrao do sidecar de resume (`<destino>.resume.json`). */
export function defaultStatePath(destination) {
  return `${destination}.resume.json`;
}

/** Cria o objeto DownloadState inicial a partir do probe. */
export function createState({ url, destination, totalSize, etag = null, lastModified = null, chunks = [] }) {
  const now = new Date().toISOString();
  return {
    version: RESUME_STATE_VERSION,
    url,
    destination,
    totalSize: Number(totalSize) || 0,
    etag: etag || null,
    lastModified: lastModified || null,
    createdAt: now,
    updatedAt: now,
    chunks: chunks.map((c) => ({
      start: Number(c.start) || 0,
      end: Number(c.end) || 0,
      downloaded: Number(c.downloaded) || 0,
      completed: Boolean(c.completed),
    })),
  };
}

/**
 * Carrega o estado persistido. Arquivo ausente, JSON invalido ou versao
 * desconhecida retornam `null` (o download recomeca do zero — seguro).
 */
export function loadState(statePath, { fsImpl = fs } = {}) {
  if (!statePath) return null;
  let raw;
  try {
    raw = fsImpl.readFileSync(statePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== RESUME_STATE_VERSION) return null;
    if (!Array.isArray(parsed.chunks) || !Number.isFinite(parsed.totalSize)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Salva o estado de forma atomica: escreve `<statePath>.tmp` e renomeia.
 * Falhas de escrita nao lancam para o chamador (resume e best-effort).
 */
export async function saveState(statePath, state, { fsImpl = fs } = {}) {
  if (!statePath || !state) return false;
  state.updatedAt = new Date().toISOString();
  const tmpPath = `${statePath}.tmp`;
  try {
    await fsImpl.promises.mkdir(path.dirname(statePath), { recursive: true });
    await fsImpl.promises.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    await fsImpl.promises.rename(tmpPath, statePath);
    return true;
  } catch {
    return false;
  }
}

/** Remove o sidecar (ignorando ausencia). */
export async function clearState(statePath, { fsImpl = fs } = {}) {
  if (!statePath) return;
  await fsImpl.promises.unlink(statePath).catch(() => {});
  await fsImpl.promises.unlink(`${statePath}.tmp`).catch(() => {});
}

/**
 * Valida o estado persistido contra o probe atual do recurso.
 *
 * @param {object} state — DownloadState carregado.
 * @param {object} probe — `{ total, etag, lastModified }` do probe atual.
 * @returns {{ ok: true } | { ok: false, code: string, reason: string }}
 *   - SIZE_CHANGED: tamanho total divergente.
 *   - ETAG_CHANGED: ETag divergiu (recurso mudou).
 *   - LAST_MODIFIED_CHANGED: Last-Modified divergiu.
 *   - NO_VALIDATOR: estado registrava validator forte (ETag) e o probe atual
 *     nao o enviou — nao da para confirmar identidade, descarta.
 */
export function validateState(state, probe = {}) {
  if (!state) return { ok: true };
  if (state.totalSize !== Number(probe.total || 0)) {
    return { ok: false, code: 'SIZE_CHANGED', reason: 'tamanho do recurso mudou' };
  }
  if (state.etag && probe.etag && state.etag !== probe.etag) {
    return { ok: false, code: 'ETAG_CHANGED', reason: 'ETag do recurso mudou' };
  }
  if (state.etag && !probe.etag) {
    return { ok: false, code: 'NO_VALIDATOR', reason: 'ETag registrado e o probe atual nao enviou validator' };
  }
  if (state.lastModified && probe.lastModified && state.lastModified !== probe.lastModified) {
    return { ok: false, code: 'LAST_MODIFIED_CHANGED', reason: 'Last-Modified do recurso mudou' };
  }
  if (state.lastModified && !probe.lastModified) {
    return { ok: false, code: 'NO_VALIDATOR', reason: 'Last-Modified registrado e o probe atual nao enviou validator' };
  }
  return { ok: true };
}

/** Soma de bytes ja concluidos no estado (para progresso continuo). */
export function completedBytes(state) {
  if (!state || !Array.isArray(state.chunks)) return 0;
  return state.chunks.reduce((acc, c) => acc + (c.completed ? c.end - c.start + 1 : 0), 0);
}

/** Nome descritivo de um estado (logs/diagnostico). */
export function describeState(state) {
  if (!state) return 'sem estado';
  const done = completedBytes(state);
  const total = state.totalSize || 0;
  return `url=${state.url} total=${total} baixado=${done} (${total > 0 ? Math.round((done / total) * 100) : 0}%)`;
}

export default { defaultStatePath, createState, loadState, saveState, clearState, validateState, completedBytes, describeState, RESUME_STATE_VERSION };
