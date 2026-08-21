import fs from 'node:fs';
import path from 'node:path';

import { StreamGrabError } from '../core/errors.js';
import { formatBytes, getDefaultDownloadsDir, normalizeHeaders, normalizeUrl } from '../utils.js';
import { probeFileDownload } from '../transports/file-probe.js';
import { createProgressReporter } from './progress.js';
import { cleanupPartial } from './download.js';
import { planFileDownload } from './file-planner.js';
import { downloadPartFiles } from './file-download-parts.js';
import { parseFileFlags, promptFileDownloadOptions, resolveExistingFileForGeneric } from './file-download-prompt.js';
import {
  buildFallbackRemote,
  DEFAULT_TURBO_CHUNKS,
  MAX_FILE_TURBO_CHUNKS,
  normalizeChunkCount,
  sanitizePreservingExtension,
} from './file-download-shared.js';

export { parseFileFlags, promptFileDownloadOptions };

export async function runFileDownloadCommand({ url, io = console, flags = {} }) {
  const target = normalizeUrl(url);
  if (!target) {
    io.error('\n[ERRO] URL invalida. Uso: streamgrab file <url>');
    return { code: 1, ok: false };
  }

  const headers = normalizeHeaders(flags.headers || {});
  const ask = typeof flags.ask === 'function' ? flags.ask : null;
  let remote;
  try {
    const probed = await probeFileDownload(target, { headers });
    remote = {
      url: probed.finalUrl,
      totalBytes: probed.totalBytes,
      contentType: probed.contentType,
      filename: sanitizePreservingExtension(probed.filename),
      capability: probed.capability,
      probeMethod: probed.probeMethod,
      metadataConfidence: probed.metadataConfidence,
      etag: probed.etag || '',
      lastModified: probed.lastModified || '',
    };
  } catch (err) {
    io.error(`\n[ERRO] Nao foi possivel sondar o arquivo: ${err.message}`);
    if (!ask) {
      return { code: 1, ok: false, error: err };
    }
    const choice = (await ask('Continuar mesmo assim usando apenas a URL informada? (S/n): ')).trim().toUpperCase();
    if (choice.startsWith('N')) {
      return { code: 1, ok: false, error: err };
    }
    io.log('[probe] Continuando sem metadados completos do servidor.');
    remote = buildFallbackRemote(target, flags.filename || '');
  }

  const dir = flags.outputDir ? path.resolve(flags.outputDir) : getDefaultDownloadsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    io.error(`\n[ERRO] Nao foi possivel usar a pasta "${dir}": ${err.message}`);
    return { code: 1, ok: false };
  }

  const resolvedName = sanitizePreservingExtension(flags.filename || remote.filename || 'arquivo.bin');
  let output = path.join(dir, resolvedName);
  if (ask) {
    const resolved = await resolveExistingFileForGeneric(ask, io, output);
    if (resolved.action === 'cancel') {
      io.log('\nCancelado.');
      return { code: 0, ok: false, cancelled: true };
    }
    output = resolved.output;
  }

  io.log(`\nArquivo detectado: ${resolvedName}`);
  if (remote.totalBytes > 0) io.log(`Tamanho: ${formatBytes(remote.totalBytes)}`);
  if (remote.contentType) io.log(`Content-Type: ${remote.contentType}`);
  if (remote.probeMethod) io.log(`Probe: ${remote.probeMethod}`);
  if (remote.capability) io.log(`Capability: ${remote.capability}`);
  io.log(`Saida: ${output}`);

  if (flags.turbo) {
    const requestedConcurrency = flags.concurrency > 0 ? flags.concurrency : DEFAULT_TURBO_CHUNKS;
    const concurrency = normalizeChunkCount(requestedConcurrency);
    const plan = planFileDownload({
      totalBytes: remote.totalBytes,
      capability: remote.capability || 'NO_RANGE',
      userConcurrency: concurrency,
      userBlockCount: flags.blockCount || 0,
      preset: flags.preset || 'auto',
    });
    if (requestedConcurrency !== concurrency) {
      io.log(`[turbo] Quantidade ajustada para ${concurrency} conexoes (maximo configurado: ${MAX_FILE_TURBO_CHUNKS}).`);
    }
    io.log(`[plan] Mode: ${plan.mode}`);
    io.log(`[plan] Preset: ${flags.preset || 'auto'}`);
    for (const reason of plan.rationale || []) io.log(`[plan] ${reason}`);
    if (plan.mode !== 'multipart') {
      io.log('[AVISO] Turbo por partes foi desativado para este download.');
      io.log('[AVISO] Continuando com download sequencial.');
    } else {
      io.log(`[turbo] Download por partes ativado (${plan.concurrency} conexoes, ${plan.blockCount} arquivos temporarios).`);
      try {
        const result = await downloadPartFiles({
          url: remote.url,
          output,
          headers,
          totalBytes: remote.totalBytes,
          etag: remote.etag || '',
          lastModified: remote.lastModified || '',
          concurrency: plan.concurrency,
          blockCount: plan.blockCount,
          io,
        });
        io.log('\nDownload concluido!');
        io.log(`Arquivo salvo em: ${result.output}`);
        return { code: 0, ok: true, output: result.output };
      } catch (err) {
        io.error(`\n[ERRO] Falha ao baixar arquivo em partes: ${err.message}`);
        return { code: 1, ok: false, error: err };
      }
    }
  }

  const progress = createProgressReporter(io, { totalBytes: remote.totalBytes, label: 'Arquivo' });
  try {
    const res = await fetch(remote.url, { method: 'GET', headers, redirect: 'follow' });
    if (!res.ok || !res.body) throw new StreamGrabError(`HTTP ${res.status} ao baixar arquivo.`, { code: 'HTTP_ERROR', status: res.status });
    const out = await fs.promises.open(output, 'w');
    try {
      const reader = res.body.getReader();
      let downloaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) {
          await out.write(value, 0, value.byteLength, downloaded);
          downloaded += value.byteLength;
          progress.update({ key: 'total_size', value: downloaded });
        }
      }
    } finally {
      await out.close().catch(() => {});
    }
    progress.finish(true);
    io.log('\nDownload concluido!');
    io.log(`Arquivo salvo em: ${output}`);
    return { code: 0, ok: true, output };
  } catch (err) {
    progress.finish(false);
    cleanupPartial(output);
    io.error(`\n[ERRO] Falha ao baixar arquivo: ${err.message}`);
    return { code: 1, ok: false, error: err };
  }
}
