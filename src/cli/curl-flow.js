import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCurlImpersonate } from '../curlimp-install.js';
import { CurlImpersonateTransport, rewritePlaylist as _rewritePlaylist, extForUri as _extForUri } from '../transports/curl.js';
import { parsePlaylistText } from '../hls.js';
import { isMdstrmUrl, needsMdstrmRefresh, extractMdstrmVideoId, refreshMdstrmUrl } from '../mdstrm.js';
import { formatBytes, maskUrl } from '../utils.js';
import { runDownloadFlow } from './download.js';
import { chooseVariant, print403, printCurlImpHelp } from './ui.js';

// Re-exportados do transporte (P4) para manter a API publica deste modulo.
export const rewritePlaylist = _rewritePlaylist;
export const extForUri = _extForUri;

export async function runCurlDownloadFlow(ctx, { ask, url, output, headers }) {
  let transport = CurlImpersonateTransport.resolve({ headers });
  if (!transport) {
    ctx.io.log('\n[curl-impersonate] Binario ausente. Tentando instalar automaticamente...');
    try {
      await installCurlImpersonate({ projectRoot: process.cwd(), io: ctx.io });
    } catch (err) {
      ctx.io.log(`[curl-impersonate] Falha na instalacao automatica: ${err.message}`);
    }
    transport = CurlImpersonateTransport.resolve({ headers });
  }
  if (!transport) {
    printCurlImpHelp(ctx.io);
    return { ok: false, error: 'curl-ausente' };
  }
  ctx.io.log(`\nModo curl-impersonate - usando ${transport.name}${transport.profile ? ` (perfil ${transport.profile})` : ''}.`);

  let workingUrl = url;
  if (isMdstrmUrl(url) && needsMdstrmRefresh(url)) {
    const videoId = extractMdstrmVideoId(url);
    if (videoId) {
      ctx.io.log(`\n[mdstrm] URL da Media Stream detectada (videoId ${videoId}).`);
      ctx.io.log('[mdstrm] Buscando credenciais do player no embed publico...');
      try {
        workingUrl = await refreshMdstrmUrl(url, transport.client);
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
    ({ text: masterText, finalUrl: masterFinal } = await transport.getText(workingUrl));
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
    ({ text: mediaText, finalUrl: mediaFinal } = await transport.getText(targetUrl));
  } catch (err) {
    if (err.status === 403) print403(ctx.io);
    else ctx.io.log(`[ERRO] Falha ao obter a playlist de segmentos: ${err.message}`);
    return { ok: false, error: 'playlist' };
  }

  const mediaBase = mediaFinal || targetUrl;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-curl-'));
  ctx.curlimpActive = true;

  try {
    const onProgress = ({ done, total, totalBytes, failed }) => {
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

    const result = await transport.downloadSegments({
      mediaText,
      mediaBase,
      tmpDir,
      shouldStop: () => ctx.interruptHandled,
      onProgress,
    });

    if (typeof ctx.io.onStatus !== 'function') process.stdout.write('\r\x1b[K');

    if (!result.ok) {
      if (result.error === 'interrupted') {
        ctx.io.log('\n\nDownload dos segmentos cancelado.');
        return { ok: false, interrupted: true };
      }
      if (result.error === 'sem segmentos') {
        ctx.io.log('\n[ERRO] Nenhum segmento foi encontrado na playlist.');
        return { ok: false, error: 'sem segmentos' };
      }
      if (result.error === 'chave') {
        ctx.io.log('\n[ERRO] Nao foi possivel baixar a chave de criptografia.');
        return { ok: false, error: 'chave' };
      }
      if (result.error === 'init') {
        ctx.io.log('\n[ERRO] Nao foi possivel baixar o segmento inicial.');
        return { ok: false, error: 'init' };
      }
      ctx.io.log(`\n\n[ERRO] Segmentos falharam (${result.error}). O video esta incompleto; abortando.`);
      return { ok: false, error: 'segmentos' };
    }

    if (ctx.interruptHandled) {
      ctx.io.log('\n\nDownload dos segmentos cancelado.');
      return { ok: false, interrupted: true };
    }

    ctx.io.log(`\nSegmentos baixados (${formatBytes(result.totalBytes)}). Gerando o video com FFmpeg...`);

    return await runDownloadFlow(ctx, {
      url: result.localPlaylist,
      output,
      headers: {},
      extraArgs: result.extraArgs,
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

