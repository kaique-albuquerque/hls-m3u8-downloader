import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DownloadEngine } from '../../src/core/engine.js';

test('core-engine progress: eventos speed/eta sao emitidos quando o update os informa', () => {
  const engine = new DownloadEngine({
    progressThrottleMs: 0,
    resolveAdapter: async () => ({ id: 'direct' }),
    executor: {
      async analyze() { return {}; },
      async prepare() { return { strategy: 'single', downloadUrl: 'https://x' }; },
      async run() { return { ok: true }; },
    },
  });

  const speeds = [];
  const etas = [];
  engine.on('speed', (p) => speeds.push(p));
  engine.on('eta', (p) => etas.push(p));

  const onProgress = engine._makeProgress({ id: 'job-test' });
  onProgress({ bytesDownloaded: 1024, percent: 10, speed: 512, etaSeconds: 9 });

  assert.equal(speeds.length, 1);
  assert.equal(speeds[0].speed, 512);
  assert.equal(etas.length, 1);
  assert.equal(etas[0].etaSeconds, 9);
});

