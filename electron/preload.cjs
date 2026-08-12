/**
 * P8 — Preload do Electron (seção 24)
 *
 * Convertido para CommonJS (.cjs) para permitir `sandbox: true` no
 * BrowserWindow: preloads em sandbox não suportam ESM e têm acesso restrito
 * (apenas `require('electron')` + polyfills do sandbox). Nenhuma API do Node
 * é exposta ao renderer — só o bridge tipado abaixo.
 *
 * Segurança (seção 24):
 *  - contextIsolation: true (no main.js)
 *  - nodeIntegration: false (no main.js)
 *  - API mínima: analyze/start/cancel/pickDir/resolvePaths/openFile/showInFolder
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  analyzePlaylist: (payload) => ipcRenderer.invoke('playlist:analyze', payload),
  startDownload: (payload) => ipcRenderer.invoke('download:start', payload),
  cancelDownload: (payload) => ipcRenderer.invoke('download:cancel', payload),
  pickOutputDir: () => ipcRenderer.invoke('app:pick-output-dir'),
  resolvePaths: () => ipcRenderer.invoke('app:resolve-paths'),
  openFile: (payload) => ipcRenderer.invoke('app:open-file', payload),
  showInFolder: (payload) => ipcRenderer.invoke('app:show-in-folder', payload),
  onDownloadLog: (cb) => ipcRenderer.on('download:log', (_e, data) => cb(data)),
  onDownloadStatus: (cb) => ipcRenderer.on('download:status', (_e, data) => cb(data)),
  onDownloadProgress: (cb) => ipcRenderer.on('download:progress', (_e, data) => cb(data)),
  onDownloadState: (cb) => ipcRenderer.on('download:state', (_e, data) => cb(data)),
  onDownloadDone: (cb) => ipcRenderer.on('download:done', (_e, data) => cb(data)),
});
