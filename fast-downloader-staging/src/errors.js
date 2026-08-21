export class FastDownloaderError extends Error {
  constructor(message, { code = 'FAST_DOWNLOADER_ERROR', status = 0, retryable = false, cause } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = Number(status) || 0;
    this.retryable = Boolean(retryable);
    if (cause !== undefined) this.cause = cause;
  }
}

function defineErrorClass(name, defaults) {
  return class extends FastDownloaderError {
    constructor(message = defaults.message, options = {}) {
      super(message, { ...defaults, ...options });
      this.name = name;
    }
  };
}

export const CancelledError = defineErrorClass('CancelledError', {
  code: 'CANCELLED',
  retryable: false,
  status: 0,
  message: 'Operação cancelada.',
});

export const NetworkError = defineErrorClass('NetworkError', {
  code: 'NETWORK_ERROR',
  retryable: true,
  status: 0,
  message: 'Falha de rede.',
});

export const ForbiddenError = defineErrorClass('ForbiddenError', {
  code: 'FORBIDDEN',
  retryable: false,
  status: 403,
  message: 'Acesso negado (403).',
});

export const RateLimitError = defineErrorClass('RateLimitError', {
  code: 'RATE_LIMIT',
  retryable: true,
  status: 429,
  message: 'Limite de requisições atingido (429).',
});
