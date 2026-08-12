/**
 * Suporte à plataforma Mídia Stream (mdstrm.com / MediastreamCDN).
 *
 * Contexto: as URLs diretas do CDN (ex.: us-b4-p-e-*.cdn.mdstrm.com/.../index-v1-a1.m3u8)
 * copiadas do DevTools dão 403 para QUALQUER cliente (até navegador real), pois as
 * variáveis de sessão (pid/sid/uid/access_token) ficam presas à sessão do player e
 * expiram. A URL que funciona é a do PLAYER:
 *
 *   https://mdstrm.com/video/<videoId>.m3u8?at=web-app&uid=<MDSTRMUID>&sid=<MDSTRMSID>&pid=<MDSTRMPID>&av=<VERSION>
 *
 * A página pública https://mdstrm.com/embed/<videoId> expõe essas variáveis inline
 * (window.MDSTRMUID / MDSTRMSID / MDSTRMPID / VERSION) — sem login nem cookies.
 * Este módulo faz essa conversão automaticamente.
 */

const EMBED_URL_RE = /mdstrm\.com\/embed\/([a-f0-9]+)/i;
const PLAYER_URL_RE = /mdstrm\.com\/video\/([a-f0-9]+)\.m3u8/i;
const CDN_URL_RE = /\/video\/h\/[^/]+\/([^/]+?)\.mp4\//i;

/** A URL pertence ao domínio mdstrm (CDN, player ou embed)? */
export function isMdstrmUrl(url) {
  return /(?:^|\.)mdstrm\.com\//i.test(String(url || ''));
}

/** Extrai o videoId de uma URL do CDN, do player ou do embed. */
export function extractMdstrmVideoId(url) {
  const s = String(url || '');
  let m = CDN_URL_RE.exec(s);
  if (m) return m[1].split('_')[0];
  m = PLAYER_URL_RE.exec(s);
  if (m) return m[1];
  m = EMBED_URL_RE.exec(s);
  if (m) return m[1];
  return null;
}

/**
 * A URL precisa de "refresh" (conversão para a URL do player)?
 *  - URL crua do CDN → sim (tokens presos à sessão).
 *  - URL do player sem as variáveis (at/uid/sid/pid) → sim.
 *  - URL do player completa → não.
 */
export function needsMdstrmRefresh(url) {
  const s = String(url || '');
  if (/(?:^|\.)cdn\.mdstrm\.com\//i.test(s)) return true;
  if (PLAYER_URL_RE.test(s)) {
    return !(/at=web-app/i.test(s) && /uid=/i.test(s) && /sid=/i.test(s) && /pid=/i.test(s));
  }
  return false;
}

/** Monta a URL do player com as variáveis de sessão. */
export function buildPlayerUrl(videoId, { uid, sid, pid, version }) {
  const q = new URLSearchParams({
    at: 'web-app',
    uid,
    sid,
    pid,
    av: version,
  });
  return `https://mdstrm.com/video/${videoId}.m3u8?${q.toString()}`;
}

/**
 * Busca as variáveis do player na página pública do embed.
 *
 * client opcional = cliente criado por createCurlClient() (do curlimp.js), para
 * imitar o TLS quando o CDN exige navegador real. Sem client, usa fetch nativo
 * do Node (o embed é público e funciona com um GET simples).
 *
 * Retorna { uid, sid, pid, version } ou lança erro se não encontrar.
 */
export async function fetchMdstrmPlayerVars(videoId, client) {
  const embedUrl = `https://mdstrm.com/embed/${videoId}`;
  let text;
  if (client?.getText) {
    ({ text } = await client.getText(embedUrl, { timeoutMs: 30000 }));
  } else {
    const res = await fetch(embedUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      err.status = res.status;
      throw err;
    }
    text = await res.text();
  }
  const grab = (re) => {
    const m = text.match(re);
    return m ? m[1] : '';
  };
  const vars = {
    uid: grab(/window\.MDSTRMUID\s*=\s*['"]([^'"]+)['"]/),
    sid: grab(/window\.MDSTRMSID\s*=\s*['"]([^'"]+)['"]/),
    pid: grab(/window\.MDSTRMPID\s*=\s*['"]([^'"]+)['"]/),
    version: grab(/window\.VERSION\s*=\s*['"]([^'"]+)['"]/),
  };
  if (!vars.uid || !vars.sid || !vars.pid || !vars.version) {
    throw new Error(`variáveis do player não encontradas no embed de ${videoId}`);
  }
  return vars;
}

/**
 * Converte URLs da Media Stream que precisam de refresh para a URL do player.
 *
 * - URL crua do CDN ou player sem vars → busca as variáveis no embed público e
 *   monta a URL do player (tokens frescos, funciona sem curl-impersonate).
 * - URL do player completa ou URL de outra plataforma → retorna como está.
 *
 * client opcional = cliente com getText() (ex.: CurlImpersonateTransport).
 */
export async function refreshMdstrmUrl(url, client) {
  const s = String(url || '');
  if (!needsMdstrmRefresh(s)) return s;
  const videoId = extractMdstrmVideoId(s);
  if (!videoId) return s;
  const vars = await fetchMdstrmPlayerVars(videoId, client);
  return buildPlayerUrl(videoId, vars);
}
