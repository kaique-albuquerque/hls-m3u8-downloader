import { youtubeDl } from 'youtube-dl-exec';

/**
 * Motor generico baseado no yt-dlp (via youtube-dl-exec, binario standalone,
 * sem necessidade de Python).
 *
 * Usado pelos adaptadores finos de YouTube e redes sociais (Facebook,
 * Instagram, TikTok, X/Twitter, Reddit, Twitch, Vimeo, etc.). O yt-dlp mantem
 * as logicas de decifracao/anti-bot atualizadas pela comunidade; aqui apenas
 * consumimos o dump JSON (URLs ja decifradas) e reaproveitamos o fluxo
 * existente de download/mux do projeto.
 */

export const YTDLP_FORMAT_UNAVAILABLE = 'YTDLP_FORMAT_UNAVAILABLE';

/** Prefixo das URIs de variantes adaptativas escolhidas no CLI/Electron. */
export const ADAPTIVE_URI_PREFIX = 'ytdlp-format:';

/**
 * Padroes de erro do yt-dlp que indicam conteudo autenticado/restrito.
 * Usados para oferecer a dica de cookies quando a analise falha.
 */
const LOGIN_REQUIRED_HINTS = [
  'sign in',
  'signin',
  'log in',
  'login',
  'private',
  'requires authentication',
  'authentication required',
  'you must be logged in',
  'members only',
  'this video is only available',
  'requested format is not available',
  '403 forbidden',
  'forbidden',
];

/** Detecta se o stderr do yt-dlp indica conteudo autenticado/restrito. */
export function isLoginRequiredError(stderr) {
  const text = String(stderr || '').toLowerCase();
  return LOGIN_REQUIRED_HINTS.some((hint) => text.includes(hint));
}

/**
 * Opcoes padrao do yt-dlp para obter apenas o JSON de formatos.
 * - preferFreeFormats: prefere formatos com codecs abertos (vp9/opus) quando
 *   disponiveis, mantendo tambem os demais formatos no JSON.
 * Nota: --no-call-home e --youtube-skip-dash-manifest foram deprecados no
 * yt-dlp 2026+ (call-home removido; skip de manifesto DASH virou automatico),
 * entao nao sao mais enviados.
 */
function buildBaseOptions() {
  return {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
  };
}

function sortFormats(a, b) {
  return b.height - a.height || b.bitrate - a.bitrate || b.itag - a.itag;
}

function sortVariants(a, b) {
  const scoreA = `${a.sourceKind || ''}` === 'adaptive' ? 1 : 0;
  const scoreB = `${b.sourceKind || ''}` === 'adaptive' ? 1 : 0;
  return scoreB - scoreA || (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0) || (b.itag || 0) - (a.itag || 0);
}

/**
 * Calcula o bitrate em bps. Prefere a estimativa por filesize/duration (mais
 * precisa). O yt-dlp vem reportando tbr/vbr/abr em kbps nos formatos atuais
 * (confirmado por filesize x duracao), entao o fallback converte para bps.
 */
function computeBitrate(format) {
  const duration = Number(format.duration) || 0;
  const size = Number(format.filesize || format.filesize_approx) || 0;
  if (duration > 0 && size > 0) return Math.round((size * 8) / duration);
  const raw = Number(format.tbr || format.vbr || format.abr) || 0;
  if (!raw) return 0;
  return raw < 1_000_000 ? Math.round(raw * 1000) : Math.round(raw);
}

/**
 * Converte um formato do JSON do yt-dlp no mesmo shape usado antigamente pelo
 * parseYouTubePlayerResponse (src/youtube.js), para nao quebrar o CLI/Electron.
 */
function mapYtDlpFormat(format) {
  const codecs = [format.vcodec, format.acodec].filter(Boolean).join(', ');
  return {
    itag: Number(format.format_id) || 0,
    formatId: String(format.format_id || ''),
    url: format.url || '',
    mimeType: format.ext ? `video/${format.ext}` : '',
    container: format.ext || '',
    codecs,
    qualityLabel: format.format_note || (format.height ? `${format.height}p` : ''),
    bitrate: computeBitrate(format),
    width: Number(format.width) || 0,
    height: Number(format.height) || 0,
    fps: Number(format.fps) || 0,
    audioQuality: format.acodec && format.acodec !== 'none' ? 'AUDIO_QUALITY_MEDIUM' : '',
    hasVideo: Boolean(format.vcodec && format.vcodec !== 'none'),
    hasAudio: Boolean(format.acodec && format.acodec !== 'none'),
    contentLength: Number(format.filesize || format.filesize_approx) || 0,
    signatureCipher: '',
  };
}

/**
 * Analisa qualquer URL suportada pelo yt-dlp e devolve a mesma estrutura de
 * analise esperada pelo CLI/Electron:
 *   { kind, pageUrl, title, videoId, durationSeconds, progressiveFormats,
 *     adaptiveFormats, adaptiveVideoFormats, adaptiveAudioFormats, variants }
 * Os variants de video adaptativo usam a URI "ytdlp-format:<formatId>" e os
 * progressivos usam a URL direta (mesmo contrato de src/youtube.js).
 */
export async function analyzeYtDlpUrl(url, headers = {}, auth = {}) {
  let info;
  try {
    const userAgent = headers?.['user-agent'] || headers?.['User-Agent'];
    const cookiesFile = auth?.cookiesFile || '';
    const cookiesFromBrowser = auth?.cookiesFromBrowser || '';
    info = await youtubeDl(url, {
      ...buildBaseOptions(),
      ...(userAgent ? { userAgent } : {}),
      ...(cookiesFile ? { cookies: cookiesFile } : {}),
      ...(cookiesFromBrowser ? { cookiesFromBrowser } : {}),
    });
  } catch (err) {
    const stderr = String(err.stderr || err.message || '');
    const needsAuth = isLoginRequiredError(stderr);
    const cause = new Error(
      needsAuth
        ? `Conteudo autenticado/restrito: o yt-dlp nao conseguiu acessar sem login. Exporte os cookies do navegador (extensao "Get cookies.txt LOCALLY") e use --cookies <arquivo>, ou use --cookies-from-browser chrome/edge/firefox. Detalhes: ${err.message || String(err)}`
        : `Nao foi possivel analisar o video com o yt-dlp: ${err.message || String(err)}`
    );
    cause.code = 'YTDLP_ANALYZE_FAILED';
    cause.stderr = err.stderr || '';
    cause.needsAuth = needsAuth;
    throw cause;
  }

  const rawFormats = Array.isArray(info?.formats) ? info.formats : [];

  const progressiveFormats = rawFormats
    .filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && f.url)
    .map(mapYtDlpFormat)
    .sort(sortFormats);

  const adaptiveVideoFormats = rawFormats
    .filter((f) => f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none') && f.url)
    .map(mapYtDlpFormat)
    .sort(sortFormats);

  const adaptiveAudioFormats = rawFormats
    .filter((f) => (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none' && f.url)
    .map(mapYtDlpFormat)
    .sort((a, b) => b.bitrate - a.bitrate || b.itag - a.itag);

  const adaptiveFormats = [...progressiveFormats, ...adaptiveVideoFormats, ...adaptiveAudioFormats].sort(sortFormats);

  if (!progressiveFormats.length && !adaptiveVideoFormats.length) {
    const err = new Error(
      'O yt-dlp nao retornou nenhum formato utilizavel para esta URL (pode ser restrita, ao vivo, protegida por DRM ou indisponivel).'
    );
    err.code = YTDLP_FORMAT_UNAVAILABLE;
    throw err;
  }

  const variants = [
    ...progressiveFormats.map((format) => ({
      uri: format.url,
      resolution: format.qualityLabel || (format.height ? `${format.height}p` : ''),
      width: format.width,
      height: format.height,
      bandwidth: format.bitrate,
      codecs: format.codecs,
      itag: format.itag,
      container: format.container,
      sourceKind: 'progressive',
    })),
    ...adaptiveVideoFormats.map((format) => ({
      uri: `${ADAPTIVE_URI_PREFIX}${format.formatId}`,
      resolution: format.qualityLabel || (format.height ? `${format.height}p` : ''),
      width: format.width,
      height: format.height,
      bandwidth: format.bitrate,
      codecs: format.codecs,
      itag: format.itag,
      container: format.container,
      sourceKind: 'adaptive',
    })),
  ].sort(sortVariants);

  return {
    kind: 'ytdlp',
    pageUrl: url,
    title: info.title || 'Video',
    videoId: info.id || '',
    durationSeconds: Number(info.duration) || 0,
    progressiveFormats,
    adaptiveFormats,
    adaptiveVideoFormats,
    adaptiveAudioFormats,
    hlsManifestUrl: info.hls_manifest_url || '',
    dashManifestUrl: info.dash_manifest_url || '',
    variants,
  };
}

/**
 * Prepara o download a partir da variante escolhida no CLI/Electron.
 * - "ytdlp-format:<formatId>" -> mux (video + melhor audio) via FFmpeg
 * - URL direta (progressivo)    -> download unico
 */
export async function prepareYtDlpDownload({ analysis, selectedUrl, headers = {}, auth = {} }) {
  if (selectedUrl?.startsWith(ADAPTIVE_URI_PREFIX)) {
    const formatId = selectedUrl.slice(ADAPTIVE_URI_PREFIX.length);
    const video = analysis?.adaptiveVideoFormats?.find((format) => format.formatId === formatId) || null;
    if (!video || !video.url) {
      const err = new Error(`Formato adaptativo ${formatId} nao encontrado na analise.`);
      err.code = YTDLP_FORMAT_UNAVAILABLE;
      throw err;
    }

    const bestAudio = analysis?.adaptiveAudioFormats?.[0] || null;
    if (!bestAudio?.url) {
      // Sem audio disponivel: entrega apenas o video (fallback gracioso).
      return {
        strategy: 'single',
        downloadUrl: video.url,
        chosenFormat: { sourceKind: 'adaptive', formatId, height: video.height },
        totalBytes: video.contentLength || undefined,
        durationMs: (analysis?.durationSeconds || 0) * 1000,
      };
    }

    const videoBytes = video.contentLength || undefined;
    const audioBytes = bestAudio.contentLength || undefined;
    return {
      strategy: 'mux',
      videoUrl: video.url,
      audioUrl: bestAudio.url,
      chosenFormat: { sourceKind: 'adaptive', formatId, height: video.height },
      videoBytes,
      audioBytes,
      totalBytes: videoBytes && audioBytes ? videoBytes + audioBytes : undefined,
      durationMs: (analysis?.durationSeconds || 0) * 1000,
    };
  }

  const progressive = analysis?.progressiveFormats?.find((format) => format.url === selectedUrl) || null;
  if (progressive?.url) {
    return {
      strategy: 'single',
      downloadUrl: progressive.url,
      chosenFormat: { sourceKind: 'progressive', formatId: progressive.formatId, height: progressive.height },
      totalBytes: progressive.contentLength || undefined,
      durationMs: (analysis?.durationSeconds || 0) * 1000,
    };
  }

  if (selectedUrl) {
    return { strategy: 'single', downloadUrl: selectedUrl };
  }

  const err = new Error('Nenhuma variante de download selecionada.');
  err.code = YTDLP_FORMAT_UNAVAILABLE;
  throw err;
}
