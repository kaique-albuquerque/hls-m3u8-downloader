// P4 — transports/ytdlp-runner: download via yt-dlp (somente quando e a
// opcao correta para a fonte).
//
// Cobre (plano §15/§16):
//  - download bem-sucedido retorna { ok: true, ... }
//  - opcoes passadas ao yt-dlp (format, output, noPlaylist, cookies)
//  - erro do yt-dlp vira YtDlpError (nao-retryable, com stderr no detail)
//  - cancelamento via signal -> CancelledError
//
// Sem rede: youtube-dl-exec é mockado via mock.module (mesmo padrao P2.6).

import assert from 'node:assert/strict';
import { test, mock } from 'node:test';

const fakeCalls = { args: [], lastOptions: null };

mock.module('youtube-dl-exec', {
  namedExports: {
    youtubeDl: async (...args) => {
      fakeCalls.args.push(args);
      fakeCalls.lastOptions = args[1] || null;
      if (fakeCalls.impl) return fakeCalls.impl(...args);
      return { url: args[0], downloaded: true };
    },
  },
});

const { runYtDlpDownload } = await import('../../src/transports/ytdlp-runner.js');
const { YtDlpError, CancelledError } = await import('../../src/core/errors.js');

test.beforeEach(() => {
  fakeCalls.args = [];
  fakeCalls.lastOptions = null;
  fakeCalls.impl = null;
});
test('runYtDlpDownload: sucesso retorna ok:true e passa as opcoes', async () => {
  const result = await runYtDlpDownload({
    url: 'https://youtube.com/watch?v=abc',
    formatId: '137',
    output: '/tmp/out.mp4',
    headers: { 'user-agent': 'Mozilla/5.0' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtube.com/watch?v=abc');
  assert.equal(fakeCalls.args.length, 1);
  const opts = fakeCalls.lastOptions;
  assert.equal(opts.format, '137', 'formatId deve virar o format selector');
  assert.equal(opts.output, '/tmp/out.mp4');
  assert.equal(opts.noPlaylist, true);
  assert.equal(opts.noWarnings, true);
  assert.equal(opts.userAgent, 'Mozilla/5.0');
});

test('runYtDlpDownload: auth cookies repassados', async () => {
  await runYtDlpDownload({
    url: 'https://youtube.com/watch?v=abc',
    output: '/tmp/out.mp4',
    auth: { cookiesFile: '/tmp/cookies.txt', cookiesFromBrowser: 'chrome' },
  });
  const opts = fakeCalls.lastOptions;
  assert.equal(opts.cookies, '/tmp/cookies.txt');
  assert.equal(opts.cookiesFromBrowser, 'chrome');
});

test('runYtDlpDownload: format padrao best quando sem formatId', async () => {
  await runYtDlpDownload({ url: 'https://x.com/v', output: '/tmp/o.mp4' });
  assert.equal(fakeCalls.lastOptions.format, 'best');
});

test('runYtDlpDownload: falha do yt-dlp vira YtDlpError nao-retryable', async () => {
  fakeCalls.impl = async () => {
    const err = new Error('ERROR: unable to download video');
    err.stderr = 'ERROR: unable to download video data: HTTP Error 403';
    err.status = 403;
    throw err;
  };

  await assert.rejects(
    runYtDlpDownload({ url: 'https://youtube.com/watch?v=abc', output: '/tmp/o.mp4' }),
    (err) => {
      assert.ok(err instanceof YtDlpError, `esperado YtDlpError, recebido ${err.constructor?.name}`);
      assert.equal(err.retryable, false, 'erro do yt-dlp nao pode ser retryable');
      assert.ok(err.detail.includes('HTTP Error 403'), `stderr deveria estar no detail: ${err.detail}`);
      return true;
    }
  );
});

test('runYtDlpDownload: validacao de argumentos obrigatorios', async () => {
  await assert.rejects(runYtDlpDownload({ output: '/tmp/o.mp4' }), /url/);
  await assert.rejects(runYtDlpDownload({ url: 'https://x.com' }), /output/);
});

test('runYtDlpDownload: abort durante o download -> CancelledError', async () => {
  const ac = new AbortController();
  let resolveImpl;
  fakeCalls.impl = () => new Promise((resolve) => {
    resolveImpl = resolve;
  });

  const p = runYtDlpDownload({ url: 'https://youtube.com/watch?v=abc', output: '/tmp/o.mp4', signal: ac.signal });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, (err) => err instanceof CancelledError || err?.code === 'CANCELLED');
  resolveImpl?.({ ok: true });
});

test('runYtDlpDownload: signal ja abortado -> CancelledError imediato', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    runYtDlpDownload({ url: 'https://youtube.com/watch?v=abc', output: '/tmp/o.mp4', signal: ac.signal }),
    (err) => err instanceof CancelledError
  );
});

test('runYtDlpDownload: onProgress chamado ao concluir', async () => {
  const events = [];
  await runYtDlpDownload({
    url: 'https://youtube.com/watch?v=abc',
    output: '/tmp/o.mp4',
    onProgress: (u) => events.push(u),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].percent, 100);
});
