/**
 * P6.2 — Baseline de performance do turbo (pré-requisito obrigatório).
 *
 * Mede throughput total e por conexão do transporte Range em 3 perfis de
 * servidor local:
 *   - normal   : sem limitação — esperado: concurrency extra ajuda
 *   - throttle : limite de throughput AGREGADO (ex.: 1 MB/s) — esperado:
 *                concurrency extra NÃO ajuda (per-connection cai)
 *   - latency  : latência fixa por request (ex.: 80 ms) — overhead por conexão
 *
 * Para cada perfil, roda com concurrency 1, 2, 4, 8, 12, 16 e registra:
 *   bytes, tempo, throughput total (MB/s), throughput por conexão (KB/s).
 *
 * Uso: node tests/performance/baseline-smart-turbo.mjs
 * Saída: console + grava tests/performance/BASELINE.md
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { downloadParallelRanges } from '../../src/transports/range.js';

const FILE_SIZE = 16 * 1024 * 1024; // 16 MiB
const THROTTLE_BPS = 1 * 1024 * 1024; // 1 MB/s agregado
const LATENCY_MS = 80;

const log = (m) => console.log(m);

// --- conteúdo pseudo-aleatório (determinístico) ---
const content = Buffer.alloc(FILE_SIZE);
for (let i = 0; i < FILE_SIZE; i++) content[i] = (i * 7 + 3) % 251;

/** Perfis de servidor: token bucket agregado (throttle) ou delay fixo (latency). */
function startServer({ throttleBps = 0, latencyMs = 0 } = {}) {
  // Bucket agregado: o chunk completo so e enviado quando ha tokens suficientes.
  // Simula limite de throughput de TODAS as conexoes juntas sem quebrar Range.
  let tokens = throttleBps;
  const waiters = [];
  const waitForTokens = (n) => {
    if (n <= tokens) {
      tokens -= n;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.push({ n, resolve }));
  };
  const server = http.createServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
      return;
    }
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : content.length - 1;
    const send = () => {
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${content.length}`,
        'Content-Length': end - start + 1,
      });
      res.end(content.subarray(start, end + 1));
    };
    if (latencyMs) return setTimeout(send, latencyMs);
    if (!throttleBps) return send();
    waitForTokens(end - start + 1).then(send);
  });
  const refill = throttleBps
    ? setInterval(() => {
        tokens = Math.min(throttleBps, tokens + throttleBps * 0.05);
        // acorda waiters que ja cabem no bucket (FIFO)
        while (waiters.length && waiters[0].n <= tokens) {
          const w = waiters.shift();
          tokens -= w.n;
          w.resolve();
        }
      }, 50)
    : null;
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        refill,
        url: `http://127.0.0.1:${server.address().port}/f.bin`,
        stop: () => {
          clearInterval(refill);
          return new Promise((r) => server.close(r));
        },
      })
    );
  });
}

async function measure({ url, concurrency }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-turbo-'));
  const output = path.join(dir, 'out.bin');
  const t0 = Date.now();
  try {
    await downloadParallelRanges({ url, output, chunkCount: 16, concurrency, validateMedia: false });
    const ms = Date.now() - t0;
    const totalMB = FILE_SIZE / 1024 / 1024;
    const totalMbps = totalMB / (ms / 1000);
    const perConnKBps = (FILE_SIZE / 1024) / (ms / 1000) / concurrency;
    return { concurrency, ms, totalMbps: totalMbps.toFixed(2), perConnKBps: perConnKBps.toFixed(0), ok: true };
  } catch (err) {
    return { concurrency, ms: 0, totalMbps: 'ERR', perConnKBps: 'ERR', ok: false, err: err.message };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CONCURRENCIES = [1, 2, 4, 8, 12, 16];

async function runProfile(name, srv) {
  log(`\n=== perfil: ${name} (${srv.url}) ===`);
  const rows = [];
  for (const c of CONCURRENCIES) {
    const r = await measure({ url: srv.url, concurrency: c });
    rows.push(r);
    log(
      `c=${String(c).padStart(2)} | ${String(r.ms).padStart(5)} ms | ` +
        `${String(r.totalMbps).padStart(6)} MB/s total | ${String(r.perConnKBps).padStart(6)} KB/s por conexao`
    );
  }
  return rows;
}

const out = [];
out.push('# Baseline — Turbo Range (P6.2)');
out.push('');
out.push(`Data: ${new Date().toISOString()} · Arquivo: ${FILE_SIZE / 1024 / 1024} MiB · `);
out.push(`throttle: ${THROTTLE_BPS / 1024 / 1024} MB/s agregado · latency: ${LATENCY_MS} ms`);
out.push('');
out.push('| c | normal (ms / MB/s / KB/s-conn) | throttle (ms / MB/s / KB/s-conn) | latency (ms / MB/s / KB/s-conn) |');
out.push('|---|-------------------------------|--------------------------------|----------------------------------|');

try {
  const srvNormal = await startServer({});
  const srvThrottle = await startServer({ throttleBps: THROTTLE_BPS });
  const srvLatency = await startServer({ latencyMs: LATENCY_MS });

  const rowsNormal = await runProfile('normal', srvNormal);
  const rowsThrottle = await runProfile('throttle-1MBps', srvThrottle);
  const rowsLatency = await runProfile(`latency-${LATENCY_MS}ms`, srvLatency);

  for (let i = 0; i < CONCURRENCIES.length; i++) {
    const n = rowsNormal[i];
    const t = rowsThrottle[i];
    const l = rowsLatency[i];
    out.push(
      `| ${CONCURRENCIES[i]} | ${n.ms} / ${n.totalMbps} / ${n.perConnKBps} | ` +
        `${t.ms} / ${t.totalMbps} / ${t.perConnKBps} | ${l.ms} / ${l.totalMbps} / ${l.perConnKBps} |`
    );
  }

  await srvNormal.stop();
  await srvThrottle.stop();
  await srvLatency.stop();
} catch (err) {
  log(`FALHOU: ${err.stack}`);
  process.exit(1);
}

out.push('');
out.push('## Leitura');
out.push('');
out.push('- **normal**: o throughput total deve crescer com a concurrency até saturar (CPU/loop);');
out.push('  o ganho por conexão extra diminui após o ponto de saturação.');
out.push('- **throttle-1MBps**: o total fica limitado em ~1 MB/s; o throughput por conexão');
out.push('  CAI proporcionalmente à concurrency → é o sinal que o Smart Turbo usa para reduzir.');
out.push('- **latency-80ms**: com latência alta, mais conexões ajudam a esconder o overhead');
out.push('  de round-trip por chunk; o ganho satura quando o pipeline fica cheio.');

const md = out.join('\n') + '\n';
fs.writeFileSync(new URL('./BASELINE.md', import.meta.url), md);
log('\nBaseline gravado em tests/performance/BASELINE.md');
