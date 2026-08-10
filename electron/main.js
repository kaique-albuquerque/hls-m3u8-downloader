import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fetchPlaylist, parsePlaylistText } from '../src/hls.js';
import { startDownload } from '../src/ffmpeg.js';
import { createCurlClient, findCurlImpersonate } from '../src/curlimp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const downloads = new Map();

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f4f7fb',
    title: 'Video Downloader',
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

ipcMain.handle('playlist:analyze', async (_event, { url, headers }) => {
  try {
    return await fetchPlaylist(url, headers || {});
  } catch (err) {
    if (err?.status !== 403) throw err;

    const found = findCurlImpersonate();
    if (!found) throw err;

    const client = createCurlClient({ cmd: found.cmd, headers: headers || {}, profile: found.profile });
    const { text, finalUrl } = await client.getText(url);
    return parsePlaylistText(text, finalUrl || url);
  }
});

ipcMain.handle('download:start', async (event, payload) => {
  const { taskId, url, output, headers, extraArgs = [] } = payload;
  const sender = event.sender;
  const task = downloads.get(taskId);
  if (task && task.stop) task.stop();

  const { promise, stop } = startDownload({
    url,
    output,
    headers,
    extraArgs,
    onProgress: (info) => {
      sender.send('download:progress', { taskId, ...info });
    },
  });

  downloads.set(taskId, { stop });
  sender.send('download:state', { taskId, state: 'running' });

  const result = await promise;
  downloads.delete(taskId);
  sender.send('download:done', { taskId, result });
  return result;
});

ipcMain.handle('download:cancel', async (_event, { taskId }) => {
  const task = downloads.get(taskId);
  if (task?.stop) task.stop();
  downloads.delete(taskId);
  return true;
});

ipcMain.handle('app:resolve-paths', async () => {
  return {
    projectRoot: PROJECT_ROOT,
    defaultDownloads: app.getPath('downloads'),
  };
});
