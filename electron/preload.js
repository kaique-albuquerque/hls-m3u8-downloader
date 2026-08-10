import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  analyzePlaylist: (payload) => ipcRenderer.invoke('playlist:analyze', payload),
  startDownload: (payload) => ipcRenderer.invoke('download:start', payload),
  cancelDownload: (payload) => ipcRenderer.invoke('download:cancel', payload),
  pickOutputDir: () => ipcRenderer.invoke('app:pick-output-dir'),
  resolvePaths: () => ipcRenderer.invoke('app:resolve-paths'),
  onDownloadProgress: (cb) => ipcRenderer.on('download:progress', (_e, data) => cb(data)),
  onDownloadState: (cb) => ipcRenderer.on('download:state', (_e, data) => cb(data)),
  onDownloadDone: (cb) => ipcRenderer.on('download:done', (_e, data) => cb(data)),
});
