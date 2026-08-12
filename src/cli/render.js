/**
 * P9 — Renderização de saída da CLI evoluída (seção 44 do architect.md).
 *
 * `streamgrab analyze <url>` produz uma saída legível (texto) ou
 * machine-readable (--json). `printAnalysisError` separa a mensagem amigável
 * do detalhe técnico (seção 42 — UX de falhas).
 */

import { formatKbps, maskUrl } from '../utils.js';
import { friendlyReport } from '../core/errors.js';

/** Converte a análise em um objeto JSON estável (independente do provider). */
export function analysisToJson({ url, adapter, info }) {
  const variants = (info.variants || []).map((v) => ({
    uri: v.uri,
    resolution: v.resolution || '',
    height: v.height || 0,
    width: v.width || 0,
    bandwidth: v.bandwidth || 0,
    codecs: v.codecs || '',
    container: v.container || '',
  }));
  return {
    url,
    sourceType: adapter.id,
    provider: adapter.label || adapter.id,
    kind: info.kind || '',
    title: info.title || '',
    durationSeconds: info.durationSeconds || info.totalDuration || 0,
    variants,
    ...(info.kind === 'dash' ? { videoRepresentations: info.videoRepresentations || [] } : {}),
  };
}

/** Imprime a análise — texto legível ou JSON (--json). */
export function renderAnalysis(io, { url, adapter, info, json = false }) {
  if (json) {
    io.log(JSON.stringify(analysisToJson({ url, adapter, info }), null, 2));
    return;
  }

  io.log(`URL: ${maskUrl(url)}`);
  io.log(`Tipo: ${adapter.label || adapter.id}`);
  if (info.title) io.log(`Titulo: ${info.title}`);
  const duration = info.durationSeconds || info.totalDuration || 0;
  if (duration > 0) io.log(`Duracao: ${formatDuration(duration)}`);

  const variants = info.variants || [];
  if (variants.length) {
    io.log(`Qualidades (${variants.length}):`);
    variants.forEach((v, i) => {
      const label = v.resolution
        ? `${v.resolution}${v.bandwidth ? `  ~${formatKbps(v.bandwidth)}` : ''}`
        : `BANDWIDTH ${v.bandwidth || '?'}`;
      io.log(`  ${i + 1}. ${label}`);
    });
  } else if (info.kind === 'dash') {
    const reps = info.videoRepresentations || [];
    io.log(`Representacoes DASH: ${reps.length}`);
    reps.slice(0, 10).forEach((r, i) => {
      io.log(`  ${i + 1}. ${r.resolution || 'sem resolucao'}${r.bandwidth ? `  ~${formatKbps(r.bandwidth)}` : ''}`);
    });
  } else if (info.kind === 'direct') {
    io.log('Arquivo direto detectado.');
  } else if (info.kind === 'media' || info.kind === 'unknown') {
    io.log('Playlist unica detectada.');
  }
}

/**
 * P11 (secao 42 — UX de falhas): imprime o erro da analise como
 * "Motivo / Acao sugerida / [Detalhes]" a partir do relatorio normalizado.
 * O detalhe tecnico so aparece quando existir (nunca no lugar da mensagem
 * amigavel).
 */
export function printAnalysisError(io, err) {
  const report = friendlyReport(err);
  io.error(`\n[ERRO] ${report.message}`);
  if (report.suggestedAction) {
    io.error(`Acao sugerida: ${report.suggestedAction}`);
  }
  if (report.detail) {
    io.error(`Detalhes: ${report.detail}`);
  }
}

/** Formata segundos como m:ss ou h:mm:ss. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
