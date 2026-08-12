import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RESOURCES_PATH_ENV } from '../src/core/binaries.js';
import { createCurlClient, findCurlImpersonate } from '../src/curlimp.js';
import { parsePlaylistText } from '../src/hls.js';
import { isMdstrmUrl, needsMdstrmRefresh, extractMdstrmVideoId, refreshMdstrmUrl } from '../src/mdstrm.js';
import { resolveSourceAdapterAsync } from '../src/source-adapters.js';
import { loadConfig } from '../src/cli/config.js';
import { normalizeHeaders } from '../src/utils.js';
import { friendlyReport } from '../src/core/errors.js';
import { normalizeMediaInfo } from './media-info.js';
import { createElectronServices } from './services.js';
import {
  validateAnalyzePayload,
  validateDownloadPayload,
  validateQueueEnqueuePayload,
  validateJobIdPayload,
  validateHistoryIdPayload,
  validateSettingsPayload,
  validateRevealPayload,
} from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// P10 (seção 7): em produção, os binários ficam em extraResources
// (resourcesPath/bin) — o core puro lê apenas o ambiente (src/core/binaries.js).
if (app.isPackaged && process.resourcesPath) {
  process.env[RESOURCES_PATH_ENV] = process.resourcesPath;
}

// P11: serviços compartilhados (Core + Queue + Settings + History) criados
// no ready() — o Electron consome StreamGrabCore/DownloadQueue diretamente,
// sem runCliSession()/createAnswerBook() para downloads (itens 1-5 do pedido).
let services = null;

// Compatibilidade: taskId (abas) -> jobId (fila real).
const taskToJob = new Map();

// Raízes permitidas para abrir/localizar arquivos (seção 24: impede path
// traversal e abertura de arquivos arbitrários via IPC).
const allowedRevealRoots = new Set();

function registerRevealRoot(dir) {
  if (typeof dir === 'string' && dir.trim()) allowedRevealRoots.add(dir.trim());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0a0f14',
    title: 'StreamGrab',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // P8 (seção 24): sandbox ativado — o preload é CommonJS (preload.cjs)
      // e o renderer roda isolado, sem acesso ao Node.
      sandbox: true,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  // P11: monta os serviços com persistência real em userData
  // (settings.json, history.json, queue.json) — itens 3-5 do pedido.
  const userDataDir = app.getPath('userData');
  const broadcast = (event, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('queue:event', { event, payload });
    }
  };

  services = createElectronServices({
    userDataDir,
    onEvent: (event, payload) => broadcast(event, payload),
  });

  // Eventos do engine que a fila não re-emite: progresso, pausa/retomada,
  // início do job, velocidade e ETA — mesmo canal `queue:event`.
  for (const event of ['start', 'progress', 'speed', 'eta', 'pause', 'resume']) {
    services.core.on(event, (payload) => broadcast(event, payload));
  }

  // Persistência final antes de sair (a fila salva a cada mudança de estado,
  // mas garante aqui no encerramento).
  app.on('before-quit', () => {
    try {
      services?.queue.save();
    } catch {
      /* ignora */
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:pick-output-dir', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  registerRevealRoot(result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('app:resolve-paths', async () => {
  const defaultDownloads = app.getPath('downloads');
  registerRevealRoot(defaultDownloads);
  registerRevealRoot(PROJECT_ROOT);
  return {
    projectRoot: PROJECT_ROOT,
    defaultDownloads,
  };
});

// P8 (seção 24): abertura/localização de arquivos concluídos — restrita às
// raízes registradas (pasta escolhida, Downloads padrão, projectRoot).
ipcMain.handle('app:open-file', async (_event, payload) => {
  const validated = validateRevealPayload(payload, [...allowedRevealRoots]);
  if (!validated) return { ok: false, error: 'Caminho inválido ou fora das pastas permitidas.' };
  const result = await shell.openPath(validated.filePath);
  return result ? { ok: false, error: result } : { ok: true };
});

ipcMain.handle('app:show-in-folder', async (_event, payload) => {
  const validated = validateRevealPayload(payload, [...allowedRevealRoots]);
  if (!validated) return { ok: false, error: 'Caminho inválido ou fora das pastas permitidas.' };
  shell.showItemInFolder(validated.filePath);
  return { ok: true };
});

async function analyzePlaylist(rawPayload) {
  // P8 (seção 24): validação da mensagem IPC antes de qualquer processamento.
  const payload = validateAnalyzePayload(rawPayload);
  if (!payload) {
    const err = new Error('URL inválida. Informe uma URL http/https.');
    err.code = 'INVALID_URL';
    throw err;
  }
  const { url, headers, auth } = payload;

  // P11.1: o Electron agora le os headers do config.json (como o CLI) e os
  // repassa para analise + download. Headers vindos do renderer vencem config.
  const config = loadConfig(PROJECT_ROOT, { log: () => {} });
  const mergedHeaders = normalizeHeaders({ ...config.headers, ...headers });

  const adapter = await resolveSourceAdapterAsync(url, mergedHeaders);
  let analysis;
  if (adapter.id === 'direct') {
    analysis = { kind: 'direct', totalDuration: 0 };
  } else if (adapter.id === 'dash') {
    analysis = await adapter.analyze({ url, headers: mergedHeaders });
  } else if (adapter.id === 'youtube' || adapter.id === 'social') {
    const mergedAuth = {
      cookiesFile: auth?.cookiesFile || config.cookiesFile || '',
      cookiesFromBrowser: auth?.cookiesFromBrowser || config.cookiesFromBrowser || '',
    };
    analysis = await adapter.analyze({ url, headers: mergedHeaders, auth: mergedAuth });
  } else if (adapter.id === 'unknown') {
    analysis = await adapter.analyze({ url, headers: mergedHeaders });
  } else {
    let workingUrl = url;
    const found = findCurlImpersonate();

    // mdstrm: URL crua do CDN (tokens presos à sessão do player) dá 403 para
    // qualquer cliente. Converte para a URL do player usando o embed público —
    // funciona SEM curl-impersonate (fetch nativo); com curl, usa o cliente
    // para imitar o TLS quando o CDN exige navegador real.
    if (isMdstrmUrl(url) && needsMdstrmRefresh(url)) {
      const videoId = extractMdstrmVideoId(url);
      if (videoId) {
        const client = found ? createCurlClient({ cmd: found.cmd, headers: mergedHeaders, profile: found.profile }) : null;
        try {
          workingUrl = await refreshMdstrmUrl(url, client);
        } catch {
          // embed público indisponível — segue com a URL original
        }
      }
    }

    try {
      analysis = await adapter.analyze({ url: workingUrl, headers: mergedHeaders });
    } catch (err) {
      if (err?.status !== 403 || !found) throw err;

      const client = createCurlClient({ cmd: found.cmd, headers: mergedHeaders, profile: found.profile });
      const { text, finalUrl } = await client.getText(workingUrl);
      analysis = parsePlaylistText(text, finalUrl || url);
    }
  }

  // P8 (seção 8/9): resposta normalizada para a UI + shape legado preservado.
  const media = normalizeMediaInfo(analysis, {
    url,
    baseUrl: analysis.baseUrl || url,
    sourceType: adapter.id === 'youtube' ? 'youtube' : adapter.id === 'social' ? 'social' : analysis.sourceType || adapter.id,
    provider: adapter.label || adapter.id,
  });
  return { ...analysis, media };
}

ipcMain.handle('playlist:analyze', async (_event, rawPayload) => {
  // P11 (secao 42 — UX de falhas): falhas viram { ok: false, error: report }
  // para a UI renderizar "Motivo / Acao sugerida / [Detalhes]".
  try {
    return await analyzePlaylist(rawPayload);
  } catch (err) {
    const report = friendlyReport(err);
    if (!report.suggestedAction && report.code === 'INVALID_URL') {
      report.suggestedAction = 'Informe uma URL completa, iniciando com http:// ou https://.';
    }
    return { ok: false, error: report };
  }
});

// ---------------------------------------------------------------------------
// P11 — downloads via StreamGrabCore + DownloadQueue (itens 1-2 do pedido)
//
// `download:start` (botão "Baixar agora", com taskId) e `queue:enqueue`
// (botão "Adicionar à fila") enfileiram na MESMA fila real com persistência:
// concorrência limitada (settings.maxConcurrentDownloads), estados aguardando/
// downloading/paused/completed/failed/cancelled, pause/resume/cancel/retry.
// Nenhum download depende de runCliSession()/createAnswerBook().
// ---------------------------------------------------------------------------

function enqueueDownload({ url, filename, outputDir, selectedUrl, title, turbo, cookiesFile, cookiesFromBrowser, taskId }) {
  if (!services) {
    const err = new Error('Serviços ainda não inicializados.');
    err.code = 'NOT_READY';
    throw err;
  }
  if (outputDir) registerRevealRoot(outputDir);

  // P11.1: headers do config.json (Referer/Origin/User-Agent) seguem para o
  // download na fila — mesmo comportamento do CLI.
  const config = loadConfig(PROJECT_ROOT, { log: () => {} });

  const job = services.queue.enqueue(url, {
    title: title || filename || '',
    meta: {
      destination: outputDir || '',
      filename: filename || '',
      selectedUrl: selectedUrl || '',
      sourceUrl: url,
      taskId: taskId || '',
      turbo: Boolean(turbo),
      headers: normalizeHeaders(config.headers),
      auth: {
        cookiesFile: cookiesFile || config.cookiesFile || '',
        cookiesFromBrowser: cookiesFromBrowser || config.cookiesFromBrowser || '',
      },
    },
  });
  if (taskId) taskToJob.set(taskId, job.id);
  services.queue.save();
  return job;
}

ipcMain.handle('download:start', async (_event, rawPayload) => {
  // P8 (seção 24): validação completa do payload antes de enfileirar.
  const payload = validateDownloadPayload(rawPayload);
  if (!payload) {
    const result = {
      code: 1,
      ok: false,
      error: {
        message: 'Payload de download inválido.',
        suggestedAction: 'Feche e reabra a aba ou reinicie o aplicativo e tente novamente.',
      },
    };
    return result;
  }
  try {
    const job = enqueueDownload(payload);
    return { ok: true, jobId: job.id };
  } catch (err) {
    const result = { code: 1, ok: false, error: friendlyReport(err) };
    return result;
  }
});

ipcMain.handle('queue:enqueue', async (_event, rawPayload) => {
  const payload = validateQueueEnqueuePayload(rawPayload);
  if (!payload) {
    return { ok: false, error: { message: 'Payload de fila inválido.', suggestedAction: 'Verifique a URL e tente novamente.' } };
  }
  try {
    const job = enqueueDownload(payload);
    return { ok: true, jobId: job.id };
  } catch (err) {
    return { ok: false, error: friendlyReport(err) };
  }
});

ipcMain.handle('queue:list', async () => {
  if (!services) return { jobs: [], maxConcurrent: 3, paused: false };
  // all(): inclui jobs terminais para a UI oferecer retry/remove.
  const jobs = services.queue.all().map((j) => ({ ...j, meta: { ...j.meta } }));
  return { jobs, maxConcurrent: services.queue.maxConcurrent, paused: services.queue.paused };
});

ipcMain.handle('queue:setPaused', async (_e, value) => {
  if (!services) return { ok: false, error: 'Serviços não inicializados' };
  services.queue.setPaused(Boolean(value));
  await services.queue.save();
  return { ok: true, paused: services.queue.paused };
});

ipcMain.handle('queue:pause', async (_event, rawPayload) => {
  const payload = validateJobIdPayload(rawPayload);
  if (!payload || !services) return false;
  try {
    services.queue.pause(payload.jobId);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('queue:resume', async (_event, rawPayload) => {
  const payload = validateJobIdPayload(rawPayload);
  if (!payload || !services) return false;
  try {
    services.queue.resume(payload.jobId);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('queue:cancel', async (_event, rawPayload) => {
  const payload = validateJobIdPayload(rawPayload);
  if (!payload || !services) return false;
  try {
    services.queue.cancel(payload.jobId);
    services.queue.save();
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('queue:retry', async (_event, rawPayload) => {
  const payload = validateJobIdPayload(rawPayload);
  if (!payload || !services) return false;
  try {
    const job = services.queue.retry(payload.jobId);
    services.queue.save();
    return { ok: true, jobId: job.id };
  } catch {
    return false;
  }
});

ipcMain.handle('queue:remove', async (_event, rawPayload) => {
  const payload = validateJobIdPayload(rawPayload);
  if (!payload || !services) return false;
  try {
    services.queue.remove(payload.jobId);
    services.queue.save();
    return true;
  } catch {
    return false;
  }
});

// Compatibilidade com o fluxo antigo de cancelamento por taskId (abas).
// Aceita { jobId } (fila real) ou { taskId } (mapeado para jobId).
ipcMain.handle('download:cancel', async (_event, rawPayload) => {
  if (!services) return false;
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  let jobId = typeof payload.jobId === 'string' && payload.jobId ? payload.jobId : '';
  if (!jobId) {
    const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
    jobId = taskToJob.get(taskId) || '';
  }
  if (!jobId) return false;
  try {
    services.queue.cancel(jobId);
    services.queue.save();
    return true;
  } catch {
    return false;
  }
});

// ---------------------------------------------------------------------------
// P11 — Histórico e Configurações (itens 3-5 do pedido)
// ---------------------------------------------------------------------------

ipcMain.handle('history:list', async () => {
  if (!services) return [];
  return services.history.list();
});

ipcMain.handle('history:remove', async (_event, rawPayload) => {
  const payload = validateHistoryIdPayload(rawPayload);
  if (!payload || !services) return false;
  services.history.remove(payload.id);
  return true;
});

ipcMain.handle('history:clear', async () => {
  if (!services) return false;
  services.history.clear();
  return true;
});

ipcMain.handle('history:redownload', async (_event, rawPayload) => {
  const payload = validateHistoryIdPayload(rawPayload);
  if (!payload || !services) return false;
  const entry = services.history.get(payload.id);
  if (!entry) return { ok: false, error: 'Entrada não encontrada no histórico.' };
  try {
    const destination = typeof entry.destination === 'string' && entry.destination ? entry.destination : '';
    const dir = destination ? path.dirname(destination) : '';
    const base = destination ? path.basename(destination, path.extname(destination)) : '';
    const job = enqueueDownload({
      url: entry.url,
      filename: base,
      outputDir: dir,
      title: entry.title || '',
    });
    return { ok: true, jobId: job.id };
  } catch (err) {
    return { ok: false, error: friendlyReport(err) };
  }
});

ipcMain.handle('settings:get', async () => {
  if (!services) return {};
  return services.settings.all();
});

ipcMain.handle('settings:update', async (_event, rawPayload) => {
  if (!services) return null;
  const clean = validateSettingsPayload(rawPayload);
  if (!clean) return null;
  return services.applySettings(clean);
});

ipcMain.handle('settings:reset', async () => {
  if (!services) return null;
  const updated = services.settings.reset();
  services.queue.setMaxConcurrent(updated.maxConcurrentDownloads);
  services.queue.save();
  return updated;
});
