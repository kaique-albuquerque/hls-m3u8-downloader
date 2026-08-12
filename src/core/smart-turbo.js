/**
 * P6.2 — Smart Turbo (secao 14 do architect.md).
 *
 * Turbo adaptativo ORIENTADO POR BASELINE (tests/performance/BASELINE.md):
 * a heuristica nasce das medicoes, nao de suposicao. O baseline local mostrou:
 *
 *  - normal (loop local, sem limite): o throughput total satura rapido e o
 *    throughput POR CONEXAO cai monotonicamente conforme a concurrency sobe.
 *  - throttle agregado (1 MB/s): o total fica ~constante em qualquer
 *    concurrency e o por-conexao cai de ~927 KB/s (c=1) para ~54 KB/s (c=16)
 *    -> queda forte do por-conexao com total estagnado = sinal de throttling.
 *  - latencia alta (80 ms/request): mais conexoes ajudam ate um teto; o
 *    por-conexao cai suavemente mesmo quando mais conexoes ainda ajudam.
 *
 * Regras derivadas:
 *  1. Subir (rampa 2 -> 4 -> 8 -> 12): apenas quando a janela anterior foi
 *     estavel (sem erros), o por-conexao NAO caiu mais que `perConnDropRatio`
 *     e o total cresceu (ou ainda estamos na rampa inicial).
 *  2. Reduzir (backoff 12 -> 8 -> ...): por-conexao caiu mais que
 *     `perConnDropRatio` (throttling) OU erros 429/5xx na janela. Depois da
 *     reducao entra em `cooldownWindows` janelas sem subir.
 *  3. Estabilizar (hold): total estagnou (ganho < `totalGainRatio`) e o
 *     por-conexao caiu suavemente -> mantem a concurrency atual.
 *  4. Limites: nunca abaixo de `min`, nunca acima de `max`. Nao induz 403/429:
 *     reduz ANTES do limite (por throughput) e, se um 429/5xx acontecer, faz
 *     backoff imediato + cooldown.
 *
 * Modulo PURO (sem I/O) e stateful: `sample()` a cada janela de medicao.
 */

export const SMART_TURBO_DEFAULTS = {
  min: 2,
  max: 12,
  initial: 2,
  windowMs: 1200,
  /** Queda do throughput por conexao que caracteriza throttling (30%). */
  perConnDropRatio: 0.3,
  /** Ganho minimo do total para justificar escalar (5%). */
  totalGainRatio: 0.05,
  /** Fator de backoff ao reduzir (12 -> 6 -> 3; arredondado para cima). */
  backoffFactor: 0.5,
  /** Janelas em cooldown apos uma reducao (nao sobe durante). */
  cooldownWindows: 3,
  /** Amostras iniciais que sempre escalam (rampa de descoberta). */
  rampUpSamples: 3,
};

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Cria um Smart Turbo stateful.
 * @param {object} [options] — sobrepoe SMART_TURBO_DEFAULTS (min/max/initial
 *   sao clampados: `initial` dentro de [min, max]).
 */
export function createSmartTurbo(options = {}) {
  const cfg = { ...SMART_TURBO_DEFAULTS, ...options };
  cfg.min = clampInt(cfg.min, 1, 64);
  cfg.max = clampInt(cfg.max, cfg.min, 64);
  cfg.initial = clampInt(cfg.initial, cfg.min, cfg.max);

  let concurrency = cfg.initial;
  let lastTotal = null; // B/s da janela anterior
  let lastPerConn = null; // B/s por conexao da janela anterior
  let cooldown = 0;
  let samples = 0;
  let growthStreak = 0; // janelas CONSECUTIVAS com totalGrew (histerese p/ up)
  let lastAction = 'hold';
  let lastReason = 'inicial';

  const normalize = (n) => Math.max(cfg.min, Math.min(cfg.max, Math.round(n)));

  /**
   * Alimenta uma janela de medicao.
   * @param {object} m
   * @param {number} m.bytes — bytes baixados na janela
   * @param {number} m.elapsedMs — duracao da janela
   * @param {number} [m.errors=0] — erros retryable (429/5xx) na janela
   * @param {number} [m.concurrency] — conexoes ativas durante a janela
   *   (default: concurrency atual)
   * @returns {{ concurrency: number, action: 'up'|'down'|'hold', reason: string,
   *            total: number, perConn: number, samples: number, cooldown: number }}
   */
  function sample({ bytes, elapsedMs, errors = 0, concurrency: active }) {
    const total = elapsedMs > 0 ? bytes / (elapsedMs / 1000) : 0;
    const perConn = active && active > 0 ? total / active : concurrency > 0 ? total / concurrency : 0;
    samples++;
    let action = 'hold';
    let reason = 'janela estavel; mantendo concurrency';

    if (errors > 0) {
      // 429/5xx -> backoff imediato + cooldown (nao induzir throttling/erros).
      const next = normalize(Math.ceil(concurrency * cfg.backoffFactor));
      if (next < concurrency) {
        concurrency = next;
        action = 'down';
      }
      cooldown = cfg.cooldownWindows;
      reason = `${errors} erro(s) retryable na janela -> backoff para ${concurrency}`;
    } else if (total === 0 && lastTotal != null) {
      // Janela sem chunks completos (latencia alta / bucket acumulando):
      // sem dados nao ha sinal de throttling — nao sobe nem pune. Em
      // latencia alta, MAIS conexoes ajudam, entao nao podemos descer aqui.
      reason = 'janela sem dados (aguardando servidor); mantendo';
    } else if (samples > 1 && lastPerConn != null && perConn < lastPerConn * (1 - cfg.perConnDropRatio)) {
      // Throttling: por-conexao caiu >30% (baseline: throttle 1MB/s cai ~50%+).
      const dropPct = Math.round((1 - perConn / lastPerConn) * 100);
      const next = normalize(Math.ceil(concurrency * cfg.backoffFactor));
      if (next < concurrency) {
        concurrency = next;
        action = 'down';
      }
      cooldown = cfg.cooldownWindows;
      reason = `throttling: por-conexao caiu ${dropPct}% -> backoff para ${concurrency}`;
    } else if (cooldown > 0) {
      cooldown--;
      reason = `cooldown (${cooldown} janelas restantes)`;
    } else if (concurrency < cfg.max) {
      // 1a amostra e so referencia; so sobe a partir da 2a.
      const totalGrew = lastTotal != null && total > lastTotal * (1 + cfg.totalGainRatio);
      // Histerese: o total medido em janelas curtas tem ruido (baseline:
      // throttle 1 MB/s oscila ~±8% entre janelas) — subir por crescimento
      // exige 2 janelas consecutivas com ganho real, senao o pool fica
      // "flapping" (sobe/desce) contra um servidor com throttle agregado.
      growthStreak = totalGrew ? growthStreak + 1 : 0;
      // Rampa de descoberta: a 1a amostra e referencia (hold); as proximas
      // `rampUpSamples` amostras sempre escalam para achar o pico.
      const ramp = samples > 1 && samples <= cfg.rampUpSamples + 1;
      if (ramp || (totalGrew && growthStreak >= 2)) {
        const next = normalize(Math.min(cfg.max, concurrency * 2));
        if (next > concurrency) {
          concurrency = next;
          action = 'up';
        }
        reason = ramp ? `rampa inicial (${samples}/${cfg.rampUpSamples})` : 'total cresceu; escalando';
      } else {
        reason = 'total estagnou; estabilizando';
      }
    } else {
      reason = 'no limite maximo';
    }

    lastTotal = total > 0 ? total : lastTotal;
    lastPerConn = perConn > 0 ? perConn : lastPerConn;
    lastAction = action;
    lastReason = reason;
    return { concurrency, action, reason, total, perConn, samples, cooldown };
  }

  return {
    /** Concurrency atual (alvo do pool). */
    getConcurrency: () => concurrency,
    /** Ultima decisao. */
    lastDecision: () => ({ action: lastAction, reason: lastReason, samples }),
    /** Reinicia o estado (nova execucao). */
    reset: () => {
      concurrency = cfg.initial;
      lastTotal = null;
      lastPerConn = null;
      cooldown = 0;
      samples = 0;
      growthStreak = 0;
      lastAction = 'hold';
      lastReason = 'inicial';
    },
    sample,
    /** Config efetiva (clampada) — util para testes/documentacao. */
    config: () => ({ ...cfg }),
  };
}

/** Normaliza o parametro `smartTurbo` (boolean | objeto) para opcoes. */
export function normalizeSmartTurbo(smartTurbo) {
  if (!smartTurbo) return null;
  const opts = typeof smartTurbo === 'object' && smartTurbo ? smartTurbo : {};
  return { ...SMART_TURBO_DEFAULTS, ...opts };
}

/** Erros de chunk que o Smart Turbo trata como sinal (429/5xx retryable). */
export function isRetryableChunkError(err) {
  if (!err) return false;
  if (err?.code === 'RATE_LIMIT_ERROR') return true;
  if (err?.retryable === true && (err?.code === 'NETWORK_ERROR' || err?.status >= 500)) return true;
  return false;
}

export default { createSmartTurbo, normalizeSmartTurbo, isRetryableChunkError, SMART_TURBO_DEFAULTS };
