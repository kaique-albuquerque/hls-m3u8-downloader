import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fetchPlaylist, parsePlaylistText, parseSegmentPlaylist } from '../src/hls.js';
import { startDownload } from '../src/ffmpeg.js';
import { createCurlClient, findCurlImpersonate } from '../src/curlimp.js';
import {
  extractMdstrmVideoId,
  fetchMdstrmPlayerVars,
  buildPlayerUrl,
  isMdstrmUrl,
  needsMdstrmRefresh,
} from '../src/mdstrm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const downloads = new Map();

const MODES = [
  { name: 'copy', args: ['-c', 'copy'] },
  { name: 'copy-adtstoasc', args: ['-c', 'copy', '-bsf:a', 'aac_adtstoasc'] },
  { name: 'aac', args: ['-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart'] },
];

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
    return await fetchPlaylist(workingUrl, headers || {});
  } catch (err) {
    if (err?.status !== 403) throw err;

    if (!found) throw err;

    const client = createCurlClient({ cmd: found.cmd, headers: headers || {}, profile: found.profile });
    const { text, finalUrl } = await client.getText(workingUrl);
    return parsePlaylistText(text, finalUrl || url);
  }
});

ipcMain.handle('download:start', async (event, payload) => {
  const { taskId, playlistUrl, variantUri, output, headers, extraArgs = [] } = payload;
  const sender = event.sender;
  const task = downloads.get(taskId);
  if (task && task.stop) task.stop();

  const found = findCurlImpersonate();
  if (isMdstrmUrl(playlistUrl)) {
    if (!found) {
      const result = {
        ok: false,
        code: -1,
        error: new Error('curl-impersonate não encontrado para baixar Mídia Stream'),
        stderr: 'curl-impersonate ausente',
        interrupted: false,
      };
      sender.send('download:done', { taskId, result });
      return result;
    }

    try {
      const result = await runMdstrmDownload({
        taskId,
        playlistUrl,
        variantUri,
        output,
        headers: headers || {},
        extraArgs,
        sender,
        found,
      });
      downloads.delete(taskId);
      sender.send('download:done', { taskId, result });
      return result;
    } catch (err) {
      const result = { ok: false, code: -1, error: err, stderr: String(err?.message || err), interrupted: false };
      downloads.delete(taskId);
      sender.send('download:done', { taskId, result });
      return result;
    }
  }

  let workingUrl = playlistUrl;
  let totalDuration = 0;
  try {
    ({ url: workingUrl, duration: totalDuration } = await prepareDownloadUrl(playlistUrl, variantUri, headers || {}));
  } catch (err) {
    const result = { ok: false, code: -1, error: err, stderr: String(err?.message || err), interrupted: false };
    sender.send('download:done', { taskId, result });
    return result;
  }

  const result = await runDownloadWithFallback({
    taskId,
    url: workingUrl,
    output,
    headers,
    extraArgs,
    duration: totalDuration,
    sender,
  });

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

async function prepareDownloadUrl(playlistUrl, variantUri = '', headers = {}) {
  let workingUrl = playlistUrl;
  let duration = 0;
  const found = findCurlImpersonate();

  if (isMdstrmUrl(playlistUrl) && needsMdstrmRefresh(playlistUrl) && found) {
    const videoId = extractMdstrmVideoId(playlistUrl);
    if (videoId) {
      const client = createCurlClient({ cmd: found.cmd, headers, profile: found.profile });
      const vars = await fetchMdstrmPlayerVars(videoId, client);
      workingUrl = buildPlayerUrl(videoId, vars);
    }
  }

  try {
    const info = await fetchPlaylist(workingUrl, headers);
    if (info.kind === 'master' && variantUri) {
      workingUrl = new URL(variantUri, info.baseUrl || workingUrl).toString();
      const mediaInfo = await fetchPlaylist(workingUrl, headers);
      if (mediaInfo.kind === 'media') {
        const res = await fetch(workingUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
        if (res.ok) {
          const text = await res.text();
          const parsed = parseSegmentPlaylist(text);
          duration = parsed.totalDuration || 0;
        }
      }
    } else if (info.kind === 'media') {
      const res = await fetch(workingUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        const text = await res.text();
        const parsed = parseSegmentPlaylist(text);
        duration = parsed.totalDuration || 0;
      }
    }
  } catch {
    /* ignora cálculo de duração */
  }

  return { url: workingUrl, duration };
}

async function runDownloadWithFallback({ taskId, url, output, headers, extraArgs, duration, sender }) {
  let lastResult = null;

  for (let modeIndex = 0; modeIndex < MODES.length; modeIndex++) {
    const mode = MODES[modeIndex];
    sender.send('download:state', {
      taskId,
      state: `running:${mode.name}`,
      duration,
      mode: mode.name,
    });

    const { promise, stop } = startDownload({
      url,
      output,
      headers,
      extraArgs,
      modeIndex,
      onProgress: (info) => {
        sender.send('download:progress', { taskId, duration, mode: mode.name, ...info });
      },
    });

    downloads.set(taskId, { stop });
    const result = await promise;
    lastResult = result;

    if (result.ok || result.interrupted) {
      if (result.interrupted) cleanupPartial(output);
      return result;
    }

    if (modeIndex < MODES.length - 1) {
      sender.send('download:state', {
        taskId,
        state: `retrying:${mode.name}`,
        duration,
        mode: mode.name,
      });
    }
  }

  cleanupPartial(output);
  return lastResult || { ok: false, code: -1, stderr: 'falha desconhecida', interrupted: false };
}

async function runMdstrmDownload({ taskId, playlistUrl, variantUri, output, headers, extraArgs, sender, found }) {
  const client = createCurlClient({ cmd: found.cmd, headers, profile: found.profile });

  let workingUrl = playlistUrl;
  if (needsMdstrmRefresh(playlistUrl)) {
    const videoId = extractMdstrmVideoId(playlistUrl);
    if (videoId) {
      const vars = await fetchMdstrmPlayerVars(videoId, client);
      workingUrl = buildPlayerUrl(videoId, vars);
    }
  }

  const { text: masterText, finalUrl: masterFinal } = await client.getText(workingUrl);
  const masterInfo = parsePlaylistText(masterText, masterFinal || workingUrl);
  const targetUrl = masterInfo.kind === 'master' && variantUri
    ? new URL(variantUri, masterInfo.baseUrl || workingUrl).toString()
    : workingUrl;

  const { text: mediaText, finalUrl: mediaFinal } = await client.getText(targetUrl);
  const mediaBase = mediaFinal || targetUrl;
  const parsed = parseSegmentPlaylist(mediaText);
  const duration = parsed.totalDuration || 0;
  const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'vd-mdstrm-'));

  try {
    const localPlaylist = path.join(tmpDir, 'local.m3u8');
    const segMap = new Map();
    const keyFiles = new Map();
    const mapFiles = new Map();

    for (const k of parsed.keys) {
      const keyUrl = new URL(k.uri, mediaBase).toString();
      const local = path.join(tmpDir, `key_${keyFiles.size}.bin`);
      const r = await client.fetch(keyUrl, local);
      if (!r.ok) throw new Error(`Falha ao baixar chave: HTTP ${r.httpCode || r.code || 'erro'}`);
      keyFiles.set(keyUrl, local);
    }

    for (const m of parsed.maps) {
      const mapUrl = new URL(m.uri, mediaBase).toString();
      const local = path.join(tmpDir, `init_${mapFiles.size}.mp4`);
      const r = await client.fetch(mapUrl, local);
      if (!r.ok) throw new Error(`Falha ao baixar init segment: HTTP ${r.httpCode || r.code || 'erro'}`);
      mapFiles.set(mapUrl, local);
    }

    const queue = parsed.segments.map((s) => ({ url: new URL(s.uri, mediaBase).toString(), uri: s.uri }));
    let done = 0;
    const total = queue.length;
    const worker = async () => {
      while (queue.length) {
        const seg = queue.shift();
        if (!seg) continue;
        const local = path.join(tmpDir, `seg_${String(done).padStart(5, '0')}.ts`);
        const r = await client.fetch(seg.url, local);
        if (!r.ok) throw new Error(`Falha ao baixar segmento: HTTP ${r.httpCode || r.code || 'erro'}`);
        segMap.set(seg.url, local);
        done += 1;
        sender.send('download:progress', { taskId, duration, key: 'out_time', value: `${String(Math.floor((done / Math.max(total, 1)) * duration)).padStart(2, '0')}:00:00` });
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    fs.writeFileSync(localPlaylist, rewritePlaylist(mediaText, segMap, keyFiles, mapFiles, mediaBase), 'utf8');
    const extra = parsed.keys.length > 0 ? ['-allowed_extensions', 'ALL'] : [];
    return await runDownloadWithFallback({
      taskId,
      url: localPlaylist,
      output,
      headers: {},
      extraArgs: [...extra, ...extraArgs],
      duration,
      sender,
    });
  } finally {
    cleanupDir(tmpDir);
  }
}

function cleanupPartial(output) {
  try {
    if (output && fs.existsSync(output)) fs.unlinkSync(output);
  } catch {
    /* ignora */
  }
}

function cleanupDir(dir) {
  try {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignora */
  }
}

function rewritePlaylist(text, segMap, keyFiles, mapFiles, baseUrl) {
  return text
    .split(/\r?\n/)
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return '';
      if (!line.startsWith('#')) {
        const resolved = new URL(line, baseUrl).toString();
        const local = segMap.get(resolved);
        return local ? path.basename(local) : line;
      }
      if (line.includes('URI="')) {
        return line.replace(/URI="([^"]*)"/g, (match, u) => {
          const resolved = new URL(u, baseUrl).toString();
          const local = keyFiles.get(resolved) || mapFiles.get(resolved);
          return local ? `URI="${path.basename(local)}"` : match;
        });
      }
      return line;
    })
    .join('\n');
}
