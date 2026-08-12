import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RESOURCES_PATH_ENV } from '../src/core/binaries.js';
import { runCliSession } from '../src/cli-flow.js';
import { createCurlClient, findCurlImpersonate } from '../src/curlimp.js';
import { parsePlaylistText } from '../src/hls.js';
import { isMdstrmUrl, needsMdstrmRefresh, extractMdstrmVideoId, refreshMdstrmUrl } from '../src/mdstrm.js';
import { resolveSourceAdapterAsync } from '../src/source-adapters.js';
import { loadConfig } from '../src/cli/config.js';
import { normalizeMediaInfo } from './media-info.js';
import {
  validateAnalyzePayload,
  validateDownloadPayload,
  validateCancelPayload,
  validateRevealPayload,
} from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// P10 (seção 7): em produção, os binários ficam em extraResources
// (resourcesPath/bin) — o core puro lê apenas o ambiente (src/core/binaries.js).
if (app.isPackaged && process.resourcesPath) {
  process.env[RESOURCES_PATH_ENV] = process.resourcesPath;
}

const downloads = new Map();

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

ipcMain.handle('playlist:analyze', async (_event, rawPayload) => {
  // P8 (seção 24): validação da mensagem IPC antes de qualquer processamento.
  const payload = validateAnalyzePayload(rawPayload);
  if (!payload) {
    const err = new Error('URL inválida. Informe uma URL http/https.');
    err.code = 'INVALID_URL';
    throw err;
  }
  const { url, headers, auth } = payload;

  const adapter = await resolveSourceAdapterAsync(url, headers);
  let analysis;
  if (adapter.id === 'direct') {
    analysis = { kind: 'direct', totalDuration: 0 };
  } else if (adapter.id === 'dash') {
    analysis = await adapter.analyze({ url, headers });
  } else if (adapter.id === 'youtube' || adapter.id === 'social') {
    const config = loadConfig(PROJECT_ROOT, { log: () => {} });
    const mergedAuth = {
      cookiesFile: auth?.cookiesFile || config.cookiesFile || '',
      cookiesFromBrowser: auth?.cookiesFromBrowser || config.cookiesFromBrowser || '',
    };
    analysis = await adapter.analyze({ url, headers, auth: mergedAuth });
  } else if (adapter.id === 'unknown') {
    analysis = await adapter.analyze({ url, headers });
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
        const client = found ? createCurlClient({ cmd: found.cmd, headers, profile: found.profile }) : null;
        try {
          workingUrl = await refreshMdstrmUrl(url, client);
        } catch {
          // embed público indisponível — segue com a URL original
        }
      }
    }

    try {
      analysis = await adapter.analyze({ url: workingUrl, headers });
    } catch (err) {
      if (err?.status !== 403 || !found) throw err;

      const client = createCurlClient({ cmd: found.cmd, headers, profile: found.profile });
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
});

ipcMain.handle('download:start', async (event, rawPayload) => {
  // P8 (seção 24): validação completa do payload antes de iniciar qualquer
  // processo (URL, taskId, filename sem traversal, outputDir absoluto).
  const payload = validateDownloadPayload(rawPayload);
  if (!payload) {
    const result = { code: 1, ok: false, error: { message: 'Payload de download inválido.' } };
    event.sender.send('download:done', { taskId: rawPayload?.taskId || 'invalid', result });
    return result;
  }

  const {
    taskId,
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
  } = payload;

  if (outputDir) registerRevealRoot(outputDir);

  const sender = event.sender;
  const previous = downloads.get(taskId);
  if (previous?.cancel) previous.cancel();

  const answers = createAnswerBook({
    url,
    filename,
    outputDir,
    qualityChoice,
    overwriteAction,
    overwriteNewName,
    useCurlOn403: forceCurl ? 'S' : '',
  });

  let cancel = () => {};
  downloads.set(taskId, { cancel });

  try {
    const result = await runCliSession({
      argv: [
        ...(forceCurl ? ['--curl-impersonate'] : []),
        ...(cookiesFile ? ['--cookies', cookiesFile] : []),
        ...(cookiesFromBrowser ? ['--cookies-from-browser', cookiesFromBrowser] : []),
        ...(turbo ? ['--turbo'] : []),
      ],
      projectRoot: PROJECT_ROOT,
      answers,
      registerCancel(fn) {
        cancel = fn;
        downloads.set(taskId, { cancel });
      },
      io: createElectronIo({ sender, taskId }),
    });

    downloads.delete(taskId);
    sender.send('download:done', { taskId, result });
    return result;
  } catch (err) {
    downloads.delete(taskId);
    const result = {
      code: 1,
      ok: false,
      error: { message: err?.message || String(err) },
      stderr: err?.stack || String(err),
    };
    sender.send('download:done', { taskId, result });
    return result;
  }
});

ipcMain.handle('download:cancel', async (_event, rawPayload) => {
  const payload = validateCancelPayload(rawPayload);
  if (!payload) return false;
  const task = downloads.get(payload.taskId);
  task?.cancel?.();
  downloads.delete(payload.taskId);
  return true;
});

function createAnswerBook({
  url,
  filename,
  outputDir,
  qualityChoice,
  overwriteAction,
  overwriteNewName,
  useCurlOn403,
}) {
  return {
    async ask(question) {
      if (question.includes('URL do video/playlist')) return String(url || '');
      if (question.includes('Escolha (Enter = melhor disponivel)')) return String(qualityChoice || '');
      if (question.includes('Nome do arquivo')) return String(filename || 'video');
      if (question.includes('Pasta de saida')) return String(outputDir || '');
      if (question.includes('(S)obrescrever, (N)ovo nome, (C)ancelar?')) {
        return normalizeOverwriteAction(overwriteAction);
      }
      if (question.includes('Novo nome do arquivo')) return String(overwriteNewName || filename || 'video');
      if (question.includes('Tentar contornar com curl-impersonate')) return String(useCurlOn403 || '');
      return '';
    },
  };
}

function normalizeOverwriteAction(value) {
  const action = String(value || 'overwrite').toLowerCase();
  if (action === 'rename') return 'N';
  if (action === 'cancel') return 'C';
  return 'S';
}

function createElectronIo({ sender, taskId }) {
  return {
    log: (...parts) => {
      sender.send('download:log', { taskId, stream: 'stdout', line: parts.join(' ') });
    },
    error: (...parts) => {
      sender.send('download:log', { taskId, stream: 'stderr', line: parts.join(' ') });
    },
    onStatus: (text) => {
      sender.send('download:status', { taskId, text });
    },
    onState: ({ state, label, output, targetUrl }) => {
      sender.send('download:state', { taskId, state, label, output, targetUrl });
    },
    onProgress: (payload) => {
      sender.send('download:progress', { taskId, ...payload });
    },
    onProgressEnd: () => {
      sender.send('download:progress', { taskId, key: 'progress', value: 'end' });
    },
  };
}
