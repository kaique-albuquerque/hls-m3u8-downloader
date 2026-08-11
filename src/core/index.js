/**
 * P2.4 — API publica do nucleo (src/core/index.js)
 *
 * Re-exporta a fachada StreamGrabCore e todos os modulos core da P2
 * (models, errors, logger, filenames, events) para consumo unico
 * por CLI, Electron e harness de teste.
 *
 * P3 — adiciona o ProviderRegistry (src/providers/registry.js) à API publica.
 *
 * P4 — adiciona Strategy, Retry e Resources (selecao de transporte, backoff
 * com Retry-After e limites de recursos) à API publica.
 */

export { StreamGrabCore, createStreamGrabCore, createDefaultExecutor } from './registry.js';
export { DownloadEngine, createDownloadEngine, defaultResolveAdapter } from './engine.js';

export { ProviderRegistry, createDefaultProviderRegistry } from '../providers/registry.js';

export { STRATEGIES, selectStrategy, resolveFallback, canFallback, isTerminalError } from './strategy.js';
export { retryWithBackoff, computeBackoffDelay, parseRetryAfter, retryAfterFromError, sleep } from './retry.js';
export { ResourceManager, Semaphore, createDefaultResourceManager } from './resources.js';

export * from './models.js';
export * from './errors.js';
export * from './logger.js';
export * from './filenames.js';
export * from './events.js';
