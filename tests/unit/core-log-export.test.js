import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { exportLogs, defaultLogPath } from '../../src/core/log-export.js';

test('log-export: exportLogs writes entries to file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-log-export-'));
  const outPath = path.join(dir, 'test-log.txt');
  const entries = [
    { timestamp: '2026-08-14T10:00:00Z', level: 'info', message: 'Download started' },
    { timestamp: '2026-08-14T10:00:01Z', level: 'error', message: 'Connection failed' },
  ];

  const result = exportLogs(entries, outPath);
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.equal(result.path, outPath);

  const content = fs.readFileSync(outPath, 'utf8');
  assert.ok(content.includes('StreamGrab Diagnostic Log'));
  assert.ok(content.includes('Download started'));
  assert.ok(content.includes('Connection failed'));
  assert.ok(content.includes('INFO'));
  assert.ok(content.includes('ERROR'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('log-export: exportLogs creates directory if missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-log-export-'));
  const outPath = path.join(dir, 'subdir', 'test-log.txt');

  const result = exportLogs([], outPath);
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(outPath));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('log-export: exportLogs returns error on invalid path', () => {
  const result = exportLogs([], 'Z:\\nonexistent\\dir\\log.txt');
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('log-export: defaultLogPath generates timestamped filename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-log-default-'));
  const p = defaultLogPath(dir);
  assert.ok(p.startsWith(dir), `path should start with ${dir}, got ${p}`);
  assert.ok(p.endsWith('.txt'));
  assert.ok(p.includes('streamgrab-logs-'));
  fs.rmSync(dir, { recursive: true, force: true });
});
