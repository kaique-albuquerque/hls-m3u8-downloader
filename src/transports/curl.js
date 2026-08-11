/**
 * P4 — Transporte curl-impersonate (plano §15/§16).
 *
 * Herda `src/curlimp.js` (cliente com perfis de browser) + `src/cli/curl-flow.js`
 * (download segmento a segmento de playlists HLS):
 *  - headers, cookies/referer, perfil de impersonacao
 *  - cancelamento (mata os processos curl ativos no abort)
 *  - cleanup de temporarios e timeouts
 *  - `downloadSegments()`: chaves, maps e segmentos com workers + tentativas
 *
 * A CLI (cli/curl-flow.js) delega aqui mantendo a API publica atual.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createCurlClient, findCurlImpersonate, killAllCurl } from '../curlimp.js';
import { parseSegmentPlaylist } from '../hls.js';

const SAFE_SEGMENT_EXT = new Set(['ts', 'mp4', 'm4s', 'm2ts', 'mts', 'aac', 'mp3', 'mov', 'm4a', '3gp', 'mj2', 'vob', 'wav']);

/** Extensao segura para salvar um segmento/mapa localmente. */
export function extForUri(uri, fallback) {
  const m = String(uri).match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i);
  const e = m ? m[1].toLowerCase() : '';
  return SAFE_SEGMENT_EXT.has(e) ? e : fallback;
}

/**
 * Reescreve a playlist media trocando URLs remotas por arquivos locais.
 * @param {string} text
 * @param {Map<string,string>} segMap — url resolvida -> arquivo local.
 * @param {Map<string,string>} keyFiles — url da chave -> arquivo local.
 * @param {Map<string,string>} mapFiles — url do init -> arquivo local.
 * @param {string} baseUrl
 */
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

const SEGMENT_WORKERS = 6;
const SEGMENT_ATTEMPTS = 3;

/**
 * Transporte de download via curl-impersonate.
 */
export class CurlImpersonateTransport {
  /**
   * @param {object} opts
   * @param {string} opts.cmd — binario curl-impersonate.
   * @param {string} [opts.name] — nome amigavel do binario.
   * @param {string} [opts.profile] — perfil --impersonate (v2.x).
   * @param {object} [opts.headers] — headers autorizados (User-Agent, Referer, cookies...).
   */
  constructor({ cmd, name, profile, headers = {} } = {}) {
    if (!cmd) throw new TypeError('CurlImpersonateTransport: cmd e obrigatorio');
    this.cmd = cmd;
    this.name = name || path.basename(cmd);
    this.profile = profile;
    this.headers = headers;
    this._client = createCurlClient({ cmd, headers, profile });
    this._active = true;
  }

  /** Localiza o curl-impersonate instalado; retorna um transporte ou null. */
  static resolve({ headers } = {}) {
    const found = findCurlImpersonate();
    if (!found) return null;
    return new CurlImpersonateTransport({ ...found, headers });
  }

  get client() {
    return this._client;
  }

  /** Mata os processos curl ativos deste transporte (cancelamento/cleanup). */
  kill() {
    killAllCurl();
  }

  dispose() {
    this._active = false;
    killAllCurl();
  }

  /**
   * Baixa `url` para `output`. Cancela (mata o processo) no abort do signal.
   * @returns {Promise<{ok: boolean, code: number, httpCode: string, finalUrl: string, stderr: string}>}
   */
  async fetch(url, output, { signal, timeoutMs = 90000 } = {}) {
    const stop = () => killAllCurl();
    if (signal) {
      if (signal.aborted) return { ok: false, code: -1, httpCode: '', finalUrl: '', stderr: 'cancelado' };
      signal.addEventListener('abort', stop, { once: true });
    }
    try {
      const result = await this._client.fetch(url, output, { timeoutMs });
      if (signal?.aborted) return { ok: false, code: -1, httpCode: '', finalUrl: '', stderr: 'cancelado' };
      return result;
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }

  /**
   * Baixa e le um texto (playlist). Lanca erro com `.status` HTTP quando 4xx.
   * @returns {Promise<{text: string, finalUrl: string}>}
   */
  async getText(url, { signal, timeoutMs = 90000 } = {}) {
    const stop = () => killAllCurl();
    if (signal) {
      if (signal.aborted) throw abortError();
      signal.addEventListener('abort', stop, { once: true });
    }
    try {
      const result = await this._client.getText(url, { timeoutMs });
      if (signal?.aborted) throw abortError();
      return result;
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }

  /**
   * Baixa chaves, maps e segmentos de uma playlist media e gera a playlist
   * local apontando para os arquivos. Tambem baixa chaves/maps.
   *
   * @param {object} params
   * @param {string} params.mediaText — texto da playlist media.
   * @param {string} params.mediaBase — URL base para resolver URIs relativas.
   * @param {string} params.tmpDir — diretorio temporario (o chamador limpa).
   * @param {AbortSignal} [params.signal]
   * @param {Function} [params.shouldStop] — `() => boolean` (Ctrl+C da CLI).
   * @param {Function} [params.onProgress] — `({done, total, totalBytes, failed})`.
   * @returns {Promise<{ok: true, localPlaylist: string, extraArgs: string[], keyCount: number, totalBytes: number}>}
   *   ou `{ok: false, error: 'chave'|'init'|'segmentos'|'interrupted'}`.
   */
  async downloadSegments({ mediaText, mediaBase, tmpDir, signal, shouldStop, onProgress } = {}) {
    const parsed = parseSegmentPlaylist(mediaText);
    if (!parsed.segments.length) return { ok: false, error: 'sem segmentos' };

    const stopped = () => (shouldStop?.() || signal?.aborted || false);

    const keyFiles = new Map();
    for (const k of parsed.keys) {
      const keyUrl = new URL(k.uri, mediaBase).toString();
      const local = path.join(tmpDir, `key_${keyFiles.size}.bin`);
      const r = await this.fetch(keyUrl, local, { signal });
      if (!r.ok) return { ok: false, error: 'chave' };
      keyFiles.set(keyUrl, local);
    }

    const fallbackExt = parsed.maps.length > 0 ? 'mp4' : 'ts';

    const mapFiles = new Map();
    for (const m of parsed.maps) {
      const mapUrl = new URL(m.uri, mediaBase).toString();
      const local = path.join(tmpDir, `init_${mapFiles.size}.${extForUri(m.uri, 'mp4')}`);
      const r = await this.fetch(mapUrl, local, { signal });
      if (!r.ok) return { ok: false, error: 'init' };
      mapFiles.set(mapUrl, local);
    }

    const segMap = new Map();
    const queue = parsed.segments.map((s) => ({ url: new URL(s.uri, mediaBase).toString(), uri: s.uri }));
    const total = queue.length;
    let nextIdx = 0;
    let done = 0;
    let failed = 0;
    let totalBytes = 0;

    const worker = async () => {
      while (queue.length) {
        if (stopped()) return;
        const seg = queue.shift();
        const local = path.join(tmpDir, `seg_${String(nextIdx++).padStart(5, '0')}.${extForUri(seg.uri, fallbackExt)}`);
        let r = null;
        for (let attempt = 1; attempt <= SEGMENT_ATTEMPTS && !stopped(); attempt++) {
          r = await this.fetch(seg.url, local, { signal });
          if (r.ok) break;
        }
        if (stopped()) return;
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
        onProgress?.({ done, total, totalBytes, failed });
      }
    };

    await Promise.all(Array.from({ length: Math.min(SEGMENT_WORKERS, total) }, worker));

    if (stopped()) return { ok: false, error: 'interrupted' };
    if (failed > 0) return { ok: false, error: 'segmentos' };

    const localPlaylist = path.join(tmpDir, 'local.m3u8');
    fs.writeFileSync(localPlaylist, rewritePlaylist(mediaText, segMap, keyFiles, mapFiles, mediaBase), 'utf8');
    const extraArgs = parsed.keys.length > 0 ? ['-allowed_extensions', 'ALL'] : [];
    return { ok: true, localPlaylist, extraArgs, keyCount: parsed.keys.length, totalBytes };
  }
}

/** Factory de conveniencia. */
export function createCurlTransport(opts) {
  return new CurlImpersonateTransport(opts);
}

function abortError() {
  const err = new Error('Operacao cancelada.');
  err.code = 'CANCELLED';
  return err;
}

export default { CurlImpersonateTransport, createCurlTransport, rewritePlaylist, extForUri };
