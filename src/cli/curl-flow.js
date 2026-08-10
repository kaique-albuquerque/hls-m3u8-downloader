import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCurlClient, findCurlImpersonate } from '../curlimp.js';
import { parsePlaylistText, parseSegmentPlaylist } from '../hls.js';
import { fetchMdstrmPlayerVars, isMdstrmUrl, needsMdstrmRefresh, extractMdstrmVideoId, buildPlayerUrl } from '../mdstrm.js';
import { formatBytes, maskUrl } from '../utils.js';
import { runDownloadFlow } from './download.js';
import { chooseVariant, print403, printCurlImpHelp } from './ui.js';

export function rewritePlaylist(text, segMap, keyFiles, mapFiles, baseUrl) {
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

const SAFE_SEGMENT_EXT = new Set(['ts', 'mp4', 'm4s', 'm2ts', 'mts', 'aac', 'mp3', 'mov', 'm4a', '3gp', 'mj2', 'vob', 'wav']);

export function extForUri(uri, fallback) {
  const m = String(uri).match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i);
  const e = m ? m[1].toLowerCase() : '';
  return SAFE_SEGMENT_EXT.has(e) ? e : fallback;
}

export async function runCurlDownloadFlow(ctx, { ask, url, output, headers }) {
  const found = findCurlImpersonate();
  if (!found) {
    printCurlImpHelp(ctx.io);
    return { ok: false, error: 'curl-ausente' };
  }
  ctx.io.log(`\nModo curl-impersonate - usando ${found.name}${found.profile ? ` (perfil ${found.profile})` : ''}.`);

  const client = createCurlClient({ cmd: found.cmd, headers, profile: found.profile });

  let workingUrl = url;
  if (isMdstrmUrl(url) && needsMdstrmRefresh(url)) {
    const videoId = extractMdstrmVideoId(url);
    if (videoId) {
      ctx.io.log(`\n[mdstrm] URL da Media Stream detectada (videoId ${videoId}).`);
      ctx.io.log('[mdstrm] Buscando credenciais do player no embed publico...');
      try {
        const vars = await fetchMdstrmPlayerVars(videoId, client);
        workingUrl = buildPlayerUrl(videoId, vars);
        ctx.io.log(`[mdstrm] URL do player gerada: ${maskUrl(workingUrl)}`);
      } catch (err) {
        ctx.io.log(`[mdstrm] Nao foi possivel converter: ${err.message}`);
        ctx.io.log('[mdstrm] Continuando com a URL original.');
      }
    }
  }

  let masterText;
  let masterFinal;
  try {
    ({ text: masterText, finalUrl: masterFinal } = await client.getText(workingUrl));
  } catch (err) {
    if (err.status === 403) print403(ctx.io);
    else ctx.io.log(`[ERRO] Falha ao obter a playlist: ${err.message}`);
    return { ok: false, error: 'playlist' };
  }

  const info = parsePlaylistText(masterText, masterFinal || workingUrl);
  let targetUrl = workingUrl;
  if (info.kind === 'master' && info.variants.length > 0) {
    const chosen = await chooseVariant(ask, ctx.io, info.variants, info.baseUrl || workingUrl);
    if (!chosen) return { ok: false, error: 'cancelado' };
    targetUrl = chosen;
    ctx.io.log(`Variant escolhida: ${maskUrl(targetUrl)}`);
  } else if (info.kind === 'unknown') {
    ctx.io.log('[AVISO] A playlist nao parece ser HLS padrao. Continuando mesmo assim.');
  }

  let mediaText;
  let mediaFinal;
  try {
    ({ text: mediaText, finalUrl: mediaFinal } = await client.getText(targetUrl));
  } catch (err) {
    if (err.status === 403) print403(ctx.io);
    else ctx.io.log(`[ERRO] Falha ao obter a playlist de segmentos: ${err.message}`);
    return { ok: false, error: 'playlist' };
  }

  const mediaBase = mediaFinal || targetUrl;
  const parsed = parseSegmentPlaylist(mediaText);
  if (!parsed.segments.length) {
    ctx.io.log('\n[ERRO] Nenhum segmento foi encontrado na playlist.');
    return { ok: false, error: 'sem segmentos' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-curl-'));
  ctx.curlimpActive = true;

  try {
    const keyFiles = new Map();
    for (const k of parsed.keys) {
      const keyUrl = new URL(k.uri, mediaBase).toString();
      const local = path.join(tmpDir, `key_${keyFiles.size}.bin`);
      const r = await client.fetch(keyUrl, local);
      if (!r.ok) {
        ctx.io.log('\n[ERRO] Nao foi possivel baixar a chave de criptografia.');
        return { ok: false, error: 'chave' };
      }
      keyFiles.set(keyUrl, local);
    }

    const fallbackExt = parsed.maps.length > 0 ? 'mp4' : 'ts';

    const mapFiles = new Map();
    for (const m of parsed.maps) {
      const mapUrl = new URL(m.uri, mediaBase).toString();
      const local = path.join(tmpDir, `init_${mapFiles.size}.${extForUri(m.uri, 'mp4')}`);
      const r = await client.fetch(mapUrl, local);
      if (!r.ok) {
        ctx.io.log('\n[ERRO] Nao foi possivel baixar o segmento inicial.');
        return { ok: false, error: 'init' };
      }
      mapFiles.set(mapUrl, local);
    }

    const segMap = new Map();
    const queue = parsed.segments.map((s) => ({ url: new URL(s.uri, mediaBase).toString(), uri: s.uri }));
    const total = queue.length;
    let nextIdx = 0;
    let done = 0;
    let failed = 0;
    let totalBytes = 0;

    const renderStatus = () => {
      const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
      const width = 22;
      const filled = Math.round((pct / 100) * width);
      const bar = `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${String(pct).padStart(3)}%`;
      const msg = `Segmentos  ${bar}  ${done}/${total} (${formatBytes(totalBytes)})${failed ? ` - ${failed} falharam` : ''}`;
      if (typeof ctx.io.onStatus === 'function') {
        ctx.io.onStatus?.(msg);
      } else {
        process.stdout.write(`\r${msg}\x1b[K`);
      }
      ctx.io.onProgress?.({ key: 'segment_progress', value: `${done}/${total}`, totalBytes, failed });
    };
    renderStatus();

    const worker = async () => {
      while (queue.length) {
        if (ctx.interruptHandled) return;
        const seg = queue.shift();
        const local = path.join(tmpDir, `seg_${String(nextIdx++).padStart(5, '0')}.${extForUri(seg.uri, fallbackExt)}`);
        let r = null;
        for (let attempt = 1; attempt <= 3 && !ctx.interruptHandled; attempt++) {
          r = await client.fetch(seg.url, local);
          if (r.ok) break;
        }
        if (ctx.interruptHandled) return;
        if (r && r.ok) {
          segMap.set(seg.url, local);
          try {
            totalBytes += fs.statSync(local).size;
          } catch {
            /* ignora */
          }
        } else {
          failed++;
        }
        done++;
        renderStatus();
      }
    };

    await Promise.all(Array.from({ length: Math.min(6, total) }, worker));

    if (typeof ctx.io.onStatus !== 'function') process.stdout.write('\r\x1b[K');

    if (ctx.interruptHandled) {
      ctx.io.log('\n\nDownload dos segmentos cancelado.');
      return { ok: false, interrupted: true };
    }
    if (failed > 0) {
      ctx.io.log(`\n\n[ERRO] ${failed} de ${total} segmentos falharam. O video esta incompleto; abortando.`);
      return { ok: false, error: 'segmentos' };
    }
    ctx.io.log(`\nSegmentos baixados (${formatBytes(totalBytes)}). Gerando o video com FFmpeg...`);

    const localPlaylist = path.join(tmpDir, 'local.m3u8');
    fs.writeFileSync(localPlaylist, rewritePlaylist(mediaText, segMap, keyFiles, mapFiles, mediaBase), 'utf8');
    const extraArgs = parsed.keys.length > 0 ? ['-allowed_extensions', 'ALL'] : [];

    return await runDownloadFlow(ctx, {
      url: localPlaylist,
      output,
      headers: {},
      extraArgs,
    });
  } finally {
    ctx.curlimpActive = false;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  }
}
