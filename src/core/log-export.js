// @ts-check
/**
 * P4.1 — Diagnostic log export (src/core/log-export.js)
 *
 * Exports the in-memory circular buffer from the logger to a file.
 * Format: timestamp | level | message (one line per entry).
 * All entries are already redacted by the logger before buffering.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Export log entries to a file.
 * @param {Array<{timestamp: string, level: string, message: string}>} entries
 * @param {string} outputPath — absolute path to the output .txt file.
 * @returns {{ ok: boolean, path: string, count: number, error?: string }}
 */
export function exportLogs(entries, outputPath) {
  try {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const lines = [
      `StreamGrab Diagnostic Log`,
      `Exported: ${new Date().toISOString()}`,
      `Entries: ${entries.length}`,
      `---`,
      ...entries.map((e) => `${e.timestamp} | ${e.level.toUpperCase().padEnd(5)} | ${e.message}`),
    ];

    fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
    return { ok: true, path: outputPath, count: entries.length };
  } catch (err) {
    return { ok: false, path: outputPath, count: 0, error: String(err.message || err) };
  }
}

/**
 * Generate a default filename for log export.
 * @param {string} [dir] — directory (default: process.cwd()).
 * @returns {string} absolute path like `streamgrab-logs-2026-08-14T12-00-00.txt`
 */
export function defaultLogPath(dir) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(dir || process.cwd(), `streamgrab-logs-${ts}.txt`);
}
