/**
 * P2.2 — Taxonomia de erros (src/core/errors.js)
 *
 * Secao 26 do architect.md: cada erro tem classe propria, mensagem amigavel
 * (para a UI), detalhe tecnico (para diagnostico) e retryability.
 *
 * classifyError() converte erros crus (status HTTP, err.code do Node, codigos
 * dos adapters) na classe correspondente, para que a UI/P2.5 nunca precise
 * decidir retry por heuristica local (secao 40 do architect.md).
 */

const SYS_RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

export class StreamGrabError extends Error {
  constructor(message, { code = 'STREAMGRAB_ERROR', detail = '', retryable = false, status = 0, cause } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.detail = detail;
    this.retryable = Boolean(retryable);
    this.status = Number(status) || 0;
    if (cause !== undefined) this.cause = cause;
  }

  /** Mensagem amigavel (para a UI). */
  get friendlyMessage() {
    return this.message;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      detail: this.detail,
      retryable: this.retryable,
      status: this.status,
    };
  }
}

function defineErrorClass(name, { code, retryable = false, defaultMessage }) {
  return class extends StreamGrabError {
    constructor(message = defaultMessage, options = {}) {
      super(message, { code, retryable, ...options });
      this.name = name;
    }
  };
}

export const UnsupportedSourceError = defineErrorClass('UnsupportedSourceError', {
  code: 'UNSUPPORTED_SOURCE',
  retryable: false,
  defaultMessage: 'Fonte nao suportada.',
});
export const NetworkError = defineErrorClass('NetworkError', {
  code: 'NETWORK_ERROR',
  retryable: true,
  defaultMessage: 'Falha de rede ao acessar o servidor.',
});
export const AuthenticationError = defineErrorClass('AuthenticationError', {
  code: 'AUTHENTICATION_ERROR',
  retryable: false,
  defaultMessage: 'Conteudo exige autenticacao (login).',
});
export const ForbiddenError = defineErrorClass('ForbiddenError', {
  code: 'FORBIDDEN_ERROR',
  retryable: false,
  defaultMessage: 'Acesso negado (403).',
});
export const RateLimitError = defineErrorClass('RateLimitError', {
  code: 'RATE_LIMIT_ERROR',
  retryable: true,
  defaultMessage: 'Limite de requisicoes atingido (429).',
});
export const ExpiredUrlError = defineErrorClass('ExpiredUrlError', {
  code: 'EXPIRED_URL_ERROR',
  retryable: false,
  defaultMessage: 'A URL expirou.',
});
export const MediaNotFoundError = defineErrorClass('MediaNotFoundError', {
  code: 'MEDIA_NOT_FOUND_ERROR',
  retryable: false,
  defaultMessage: 'Midia nao encontrada (404).',
});
export const FFmpegError = defineErrorClass('FFmpegError', {
  code: 'FFMPEG_ERROR',
  retryable: false,
  defaultMessage: 'Falha ao processar com FFmpeg.',
});
export const YtDlpError = defineErrorClass('YtDlpError', {
  code: 'YTDLP_ERROR',
  retryable: false,
  defaultMessage: 'Falha ao analisar com yt-dlp.',
});
export const DiskSpaceError = defineErrorClass('DiskSpaceError', {
  code: 'DISK_SPACE_ERROR',
  retryable: false,
  defaultMessage: 'Espaco em disco insuficiente.',
});
export const PermissionError = defineErrorClass('PermissionError', {
  code: 'PERMISSION_ERROR',
  retryable: false,
  defaultMessage: 'Sem permissao de escrita.',
});
export const UnsupportedDrmError = defineErrorClass('UnsupportedDrmError', {
  code: 'UNSUPPORTED_DRM_ERROR',
  retryable: false,
  defaultMessage: 'Conteudo protegido por DRM nao e suportado.',
});
export const CancelledError = defineErrorClass('CancelledError', {
  code: 'CANCELLED',
  retryable: false,
  defaultMessage: 'Operacao cancelada pelo usuario.',
});

export function isStreamGrabError(err) {
  return err instanceof StreamGrabError;
}

export function isRetryable(err) {
  return err instanceof StreamGrabError ? err.retryable : false;
}

/**
 * Classifica um erro cru na classe correspondente da taxonomia.
 * - Erros ja classificados (StreamGrabError) passam direto.
 * - Status HTTP: 401 -> Authentication, 403 -> Forbidden, 404 -> NotFound,
 *   429 -> RateLimit, >=500 -> Network (retryable).
 * - err.code do Node: ECONNRESET/ETIMEDOUT/... -> Network (retryable),
 *   ENOSPC -> DiskSpace, EACCES/EPERM -> Permission.
 * - Codigos dos adapters: UNSUPPORTED_SOURCE, YTDLP_ANALYZE_FAILED (com
 *   needsAuth vira Authentication), YTDLP_FORMAT_UNAVAILABLE, FFMPEG_ERROR,
 *   CANCELLED.
 * - Caso contrario: StreamGrabError generico (nao retryable).
 */
export function classifyError(err, options = {}) {
  if (err instanceof StreamGrabError) return err;
  const status = Number(err?.status || options?.status || 0);
  const code = String(err?.code || '');
  const message = String(err?.message || String(err) || 'Erro desconhecido.');
  const detail = String(err?.stderr || err?.detail || '');
  const cause = err;

  const wrap = (Cls, extra = {}) => new Cls(message, { detail, cause, ...extra });

  if (status === 401) return wrap(AuthenticationError, { status });
  if (status === 403) return wrap(ForbiddenError, { status });
  if (status === 404) return wrap(MediaNotFoundError, { status });
  if (status === 429) return wrap(RateLimitError, { status });
  if (status >= 500) return wrap(NetworkError, { status, retryable: true });
  if (code === 'UNSUPPORTED_SOURCE') return wrap(UnsupportedSourceError);
  if (code === 'YTDLP_ANALYZE_FAILED') {
    return err?.needsAuth ? wrap(AuthenticationError) : wrap(YtDlpError);
  }
  if (code === 'YTDLP_FORMAT_UNAVAILABLE') return wrap(YtDlpError);
  if (code === 'FFMPEG_ERROR' || code === 'FFMPEG_FAILED') return wrap(FFmpegError);
  if (code === 'CANCELLED' || code === 'ABORT_ERR') return wrap(CancelledError);
  if (SYS_RETRYABLE_CODES.has(code)) return wrap(NetworkError, { retryable: true, status });
  if (code === 'ENOSPC') return wrap(DiskSpaceError);
  if (code === 'EACCES' || code === 'EPERM') return wrap(PermissionError);
  return new StreamGrabError(message, {
    code: code || 'STREAMGRAB_ERROR',
    detail,
    retryable: false,
    cause,
    status,
  });
}
