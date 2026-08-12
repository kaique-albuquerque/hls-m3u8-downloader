/**
 * P8 — Segurança do Electron (seção 24 do architect.md)
 *
 * Módulo puro (sem dependência do Electron) com as validações usadas pelo
 * processo principal antes de aceitar qualquer mensagem IPC do renderer:
 *
 *  - URLs não confiáveis: apenas http/https
 *  - taskId: formato restrito (sem caracteres especiais)
 *  - filename: sem separadores de path, sem traversal (..)
 *  - outputDir: path absoluto, sem segmentos ".."
 *  - payloads: shape tipado dos handlers de IPC
 *
 * Regra da seção 24: "Nunca montar comandos como strings de shell com
 * entrada do usuário se argumentos estruturados puderem ser usados." — aqui
 * não construímos comandos; apenas validamos os campos que fluem para o
 * fluxo CLI/engine (que já usa argv estruturado).
 */

const URL_PROTOCOL_RE = /^https?:\/\//i;
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILENAME_BAD_RE = /[\\/]|\.\./;
const ABSOLUTE_WIN_RE = /^[A-Za-z]:[\\/]/;
const ABSOLUTE_POSIX_RE = /^\//;

/** Valida uma URL não confiável vinda do renderer (apenas http/https). */
export function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const url = String(value).trim();
  if (!URL_PROTOCOL_RE.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Valida o identificador de tarefa (formato restrito). */
export function isValidTaskId(value) {
  return typeof value === 'string' && TASK_ID_RE.test(value);
}

/** Normaliza/valida um nome de arquivo: sem separadores nem traversal. */
export function sanitizeDownloadFilename(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Checa traversal ANTES de substituir separadores (../etc não vira _etc).
  if (FILENAME_BAD_RE.test(raw)) return '';
  const cleaned = raw
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[.\s]+$/g, '')
    .replace(/^[.\s]+/g, '');
  if (!cleaned) return '';
  if (FILENAME_BAD_RE.test(cleaned)) return '';
  return cleaned;
}

/** Verifica se um caminho é absoluto (Windows ou POSIX). */
export function isAbsolutePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  return ABSOLUTE_WIN_RE.test(value) || ABSOLUTE_POSIX_RE.test(value);
}

/** Verifica se um caminho absoluto não contém segmentos ".." de traversal. */
export function isSafeAbsolutePath(value) {
  if (!isAbsolutePath(value)) return false;
  const segments = String(value).split(/[\\/]+/);
  return !segments.includes('..');
}

/** Valida o payload de `playlist:analyze`. Retorna o payload limpo ou null. */
export function validateAnalyzePayload(payload = {}) {
  const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
  if (!isSafeHttpUrl(url)) return null;
  const headers = payload?.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers)
    ? payload.headers
    : {};
  const rawAuth = payload?.auth && typeof payload.auth === 'object' && !Array.isArray(payload.auth) ? payload.auth : {};
  const auth = {
    cookiesFile: typeof rawAuth.cookiesFile === 'string' ? rawAuth.cookiesFile : '',
    cookiesFromBrowser: typeof rawAuth.cookiesFromBrowser === 'string' ? rawAuth.cookiesFromBrowser : '',
  };
  return { url, headers, auth };
}

/** Valida o payload de `download:start`. Retorna o payload limpo ou null. */
export function validateDownloadPayload(payload = {}) {
  if (!isValidTaskId(payload?.taskId)) return null;
  const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
  if (!isSafeHttpUrl(url)) return null;

  const filename = sanitizeDownloadFilename(payload?.filename);
  if (!filename) return null;

  const outputDir = typeof payload?.outputDir === 'string' ? payload.outputDir.trim() : '';
  if (outputDir && !isSafeAbsolutePath(outputDir)) return null;

  const qualityChoice = typeof payload?.qualityChoice === 'string' ? payload.qualityChoice : '';
  if (qualityChoice && !/^\d+$/.test(qualityChoice)) return null;

  const overwriteAction = ['overwrite', 'rename', 'cancel'].includes(payload?.overwriteAction)
    ? payload.overwriteAction
    : 'overwrite';
  const overwriteNewName = sanitizeDownloadFilename(payload?.overwriteNewName) || '';
  const forceCurl = payload?.forceCurl === true;
  const turbo = payload?.turbo === true;

  const cookiesFile = typeof payload?.cookiesFile === 'string' ? payload.cookiesFile : '';
  const cookiesFromBrowser = typeof payload?.cookiesFromBrowser === 'string' ? payload.cookiesFromBrowser : '';

  return {
    taskId: String(payload.taskId),
    url,
    filename,
    outputDir,
    qualityChoice,
    overwriteAction,
    overwriteNewName,
    forceCurl,
    turbo,
    cookiesFile,
    cookiesFromBrowser,
  };
}

/** Valida o payload de `download:cancel`. */
export function validateCancelPayload(payload = {}) {
  if (!isValidTaskId(payload?.taskId)) return null;
  return { taskId: String(payload.taskId) };
}

/** Valida o payload de `app:open-file` / `app:show-in-folder`. */
export function validateRevealPayload(payload = {}, allowedRoots = []) {
  const filePath = typeof payload?.filePath === 'string' ? payload.filePath.trim() : '';
  if (!filePath) return null;
  if (!isSafeAbsolutePath(filePath)) return null;
  // O caminho deve estar dentro de uma das raízes permitidas (output dir,
  // Downloads padrão, projectRoot) — impede abrir arquivos arbitrários.
  if (!allowedRoots.some((root) => typeof root === 'string' && root && isPathWithin(filePath, root))) {
    return null;
  }
  return { filePath };
}

/** Verifica se `child` está dentro de `root` (ambos absolutos). */
export function isPathWithin(child, root) {
  const norm = (p) => String(p).replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  const c = norm(child).toLowerCase();
  const r = norm(root).toLowerCase();
  return c === r || c.startsWith(`${r}/`);
}
