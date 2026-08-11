import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCliSession } from '../src/cli-flow.js';
import { createCurlClient, findCurlImpersonate } from '../src/curlimp.js';
import { parsePlaylistText } from '../src/hls.js';
import {
  extractMdstrmVideoId,
  fetchMdstrmPlayerVars,
  buildPlayerUrl,
  isMdstrmUrl,
  needsMdstrmRefresh,
} from '../src/mdstrm.js';
import { resolveSourceAdapterAsync } from '../src/source-adapters.js';
import { loadConfig } from '../src/cli/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const downloads = new Map();

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0a0f14',
    title: 'StreamGrab',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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
  return result.filePaths[0];
});

ipcMain.handle('app:resolve-paths', async () => {
  return {
    projectRoot: PROJECT_ROOT,
    defaultDownloads: app.getPath('downloads'),
  };
});

ipcMain.handle('playlist:analyze', async (_event, { url, headers, auth }) => {
  const adapter = await resolveSourceAdapterAsync(url, headers || {});
  if (adapter.id === 'direct') return { kind: 'direct' };
  if (adapter.id === 'dash') return await adapter.analyze({ url, headers: headers || {} });
  if (adapter.id === 'youtube' || adapter.id === 'social') {
    const config = loadConfig(PROJECT_ROOT, { log: () => {} });
    const mergedAuth = {
      cookiesFile: auth?.cookiesFile || config.cookiesFile || '',
      cookiesFromBrowser: auth?.cookiesFromBrowser || config.cookiesFromBrowser || '',
    };
    return await adapter.analyze({ url, headers: headers || {}, auth: mergedAuth });
  }
  if (adapter.id === 'unknown') return await adapter.analyze({ url, headers: headers || {} });

  let workingUrl = url;
  const found = findCurlImpersonate();

  if (isMdstrmUrl(url) && needsMdstrmRefresh(url) && found) {
    const videoId = extractMdstrmVideoId(url);
    if (videoId) {
      const client = createCurlClient({ cmd: found.cmd, headers: headers || {}, profile: found.profile });
      const vars = await fetchMdstrmPlayerVars(videoId, client);
      workingUrl = buildPlayerUrl(videoId, vars);
    }
  }

  try {
    return await adapter.analyze({ url: workingUrl, headers: headers || {} });
  } catch (err) {
    if (err?.status !== 403 || !found) throw err;

    const client = createCurlClient({ cmd: found.cmd, headers: headers || {}, profile: found.profile });
    const { text, finalUrl } = await client.getText(workingUrl);
    return parsePlaylistText(text, finalUrl || url);
  }
});

ipcMain.handle('download:start', async (event, payload) => {
  const {
    taskId,
    url,
    filename = 'video',
    outputDir = '',
    qualityChoice = '',
    overwriteAction = 'overwrite',
    overwriteNewName = '',
    forceCurl = false,
    cookiesFile = '',
    cookiesFromBrowser = '',
    turbo = false,
  } = payload;

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

ipcMain.handle('download:cancel', async (_event, { taskId }) => {
  const task = downloads.get(taskId);
  task?.cancel?.();
  downloads.delete(taskId);
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
