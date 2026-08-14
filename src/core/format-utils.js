/**
 * Formatting utilities for StreamGrab.
 *
 * Extracted from src/utils.js (Sprint 2.3) for focused module responsibility.
 * All exports are re-exported from src/utils.js for backward compatibility.
 */

/** Formata bytes para B/KB/MB/GB/TB. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Formata bandwidth (bps) do HLS para Kbps/Mbps. */
export function formatKbps(bandwidth) {
  const n = Number(bandwidth) || 0;
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(n / 1000)} Kbps`;
}
