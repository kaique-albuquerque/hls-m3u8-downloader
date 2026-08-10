const STREAM_INF_RE = /^#EXT-X-STREAM-INF:(.*)$/;

/**
 * Interpreta a lista de atributos de uma linha #EXT-X-STREAM-INF,
 * respeitando valores entre aspas que podem conter vírgulas
 * (ex.: CODECS="avc1.640028,mp4a.40.2").
 */
export function parseAttributes(str) {
  const attrs = {};
  const s = String(str ?? '');
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;
    let name = '';
    while (i < s.length && s[i] !== '=') name += s[i++];
    i++; // pula o '='
    let value = '';
    if (s[i] === '"') {
      i++;
      while (i < s.length && s[i] !== '"') value += s[i++];
      i++; // pula a aspa final
    } else {
      while (i < s.length && s[i] !== ',' && !/\s/.test(s[i])) value += s[i++];
    }
    attrs[name.trim()] = value;
  }
  return attrs;
}

/**
 * Interpreta o texto de uma playlist HLS (sem rede).
 *
 * Retorna:
 *  - { kind: 'master', variants, baseUrl }  → contém #EXT-X-STREAM-INF
 *  - { kind: 'media' }                      → playlist de segmentos (variant)
 *  - { kind: 'unknown' }                    → não parece HLS padrão
 */
export function parsePlaylistText(text, baseUrl = '') {
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(STREAM_INF_RE);
    if (!match) continue;

    const attrs = parseAttributes(match[1]);

    // A URI da variante é a próxima linha que não seja comentário/vazia.
    let uri = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j]) continue;
      if (lines[j].startsWith('#')) break; // linha de atributo sem URI
      uri = lines[j];
      break;
    }
    if (!uri) continue;

    const [w, h] = String(attrs.RESOLUTION || '').split('x').map(Number);
    variants.push({
      uri,
      resolution: attrs.RESOLUTION || '',
      width: Number.isFinite(w) ? w : 0,
      height: Number.isFinite(h) ? h : 0,
      bandwidth: Number(attrs.BANDWIDTH) || 0,
      codecs: attrs.CODECS || '',
    });
  }

  if (variants.length > 0) {
    // Remove duplicatas (mesma URI) e ordena por resolução, depois bandwidth.
    const seen = new Set();
    const unique = variants.filter((v) => {
      if (seen.has(v.uri)) return false;
      seen.add(v.uri);
      return true;
    });
    unique.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
    // baseUrl: após redirects, URIs relativas resolvem contra a URL final.
    return { kind: 'master', variants: unique, baseUrl: baseUrl || '' };
  }

  if (text.includes('#EXTINF') || text.includes('#EXT-X-TARGETDURATION')) {
    return { kind: 'media' };
  }

  return { kind: 'unknown' };
}

/**
 * Baixa e interpreta uma playlist HLS.
 *
 * Retorna o mesmo formato de parsePlaylistText, com baseUrl = URL final
 * (após redirects) para resolução de URIs relativas.
 */
export async function fetchPlaylist(url, headers = {}, timeoutMs = 30000) {
  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
    err.status = res.status;
    throw err;
  }

  const text = await res.text();
  return parsePlaylistText(text, res.url || url);
}

/**
 * Interpreta uma playlist de segmentos (variant/media).
 *
 * Retorna:
 *  - segments: [{ uri, key }]          URIs dos segmentos (com a chave AES ativa, se houver)
 *  - keys:     [{ uri, iv, method }]   chaves de criptografia distintas (#EXT-X-KEY)
 *  - maps:     [{ uri }]               segmentos de inicialização (#EXT-X-MAP, fMP4)
 *  - targetDuration
 */
export function parseSegmentPlaylist(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const segments = [];
  const keys = new Map();
  const maps = new Map();
  let targetDuration = 0;
  let totalDuration = 0;
  let currentKey = null;
  let pendingExtinf = null;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseInt(line.split(':')[1], 10) || 0;
    } else if (line.startsWith('#EXTINF:')) {
      const dur = parseFloat(line.slice('#EXTINF:'.length).split(',')[0]);
      pendingExtinf = Number.isFinite(dur) ? dur : null;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
      const method = String(attrs.METHOD || 'NONE').toUpperCase();
      if (method === 'NONE') {
        currentKey = null;
      } else if (attrs.URI) {
        currentKey = { uri: attrs.URI, iv: attrs.IV || '', method };
        if (!keys.has(attrs.URI)) keys.set(attrs.URI, currentKey);
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
      if (attrs.URI && !maps.has(attrs.URI)) maps.set(attrs.URI, { uri: attrs.URI });
    } else if (line && !line.startsWith('#')) {
      // Linha de URI de segmento (segue a linha #EXTINF).
      segments.push({ uri: line, key: currentKey ? { ...currentKey } : null });
      if (pendingExtinf !== null) totalDuration += pendingExtinf;
      pendingExtinf = null;
    }
  }

  return {
    segments,
    keys: [...keys.values()],
    maps: [...maps.values()],
    targetDuration,
    totalDuration,
  };
}
