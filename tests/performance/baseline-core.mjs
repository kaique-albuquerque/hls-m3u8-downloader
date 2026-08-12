/**
 * P11 — Baseline de performance do core (secao 49 do architect.md).
 *
 * Mede, em servidores/fixtures LOCAIS (sem rede externa):
 *   - analise: tempo de `analyze` do provider HLS (master e media) e DASH
 *   - download: throughput do transporte Range em arquivo grande (16 MiB)
 *   - CPU/memoria: delta de process.cpuUsage()/memoryUsage() nas operacoes
 *   - mux: remux FFmpeg de um clip de teste (pulado se FFmpeg ausente)
 *
 * Uso: node tests/performance/baseline-core.mjs
 * Saida: console + grava docs/performance.md
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveSourceAdapterAsync } from '../../src/source-adapters.js';
import { downloadParallelRanges } from '../../src/transports/range.js';
import { checkFfmpeg, getFfmpegCommand } from '../../src/ffmpeg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const DOCS = path.join(ROOT, 'docs');

const FILE_SIZE = 16 * 1024 * 1024; // 16 MiB
const RUNS = 5; // repeticoes por medicao (mediana)
const log = (m) => console.log(m);

// --- conteudo pseudo-aleatorio determinístico ---
const content = Buffer.alloc(FILE_SIZE);
for (let i = 0; i < FILE_SIZE; i++) content[i] = (i * 7 + 3) % 251;

/** Servidor HTTP local com suporte a Range (serve um diretorio ou o buffer). */
function startServer({ rootDir = null, serveBuffer = null } = {}) {
  const server = http.createServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (serveBuffer) {
      const start = m ? Number(m[1]) : 0;
      const end = m ? (m[2] ? Number(m[2]) : serveBuffer.length - 1) : serveBuffer.length - 1;
      res.writeHead(m ? 206 : 200, {
        'Content-Range': `bytes ${start}-${end}/${serveBuffer.length}`,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
      });
      res.end(serveBuffer.subarray(start, end + 1));
      return;
    }
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(rootDir, urlPath);
    if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Length': data.length });
    res.end(data);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Executa fn N vezes e retorna { medianMs, minMs, samplesMs }. */
async function measureMs(fn, runs = RUNS) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint();
    await fn();
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    samples.push(ms);
  }
  return { medianMs: median(samples), minMs: Math.min(...samples), samplesMs: samples };
}

function cpuDeltaMs(before, after) {
  const dUser = after.user - before.user;
  const dSys = after.system - before.system;
  return (dUser + dSys) / 1000; // microssegundos -> ms
}

async function measureAnalyze() {
  const { server, port } = await startServer({ rootDir: FIXTURES });
  try {
    const base = `http://127.0.0.1:${port}`;
    const targets = [
      { name: 'HLS master', url: `${base}/hls/master.m3u8` },
      { name: 'HLS media', url: `${base}/hls/media.m3u8` },
      { name: 'DASH manifest', url: `${base}/dash/manifest.mpd` },
    ];
    const results = [];
    for (const t of targets) {
      const { medianMs, minMs } = await measureMs(async () => {
        const adapter = await resolveSourceAdapterAsync(t.url);
        await adapter.analyze({ url: t.url, headers: {} });
      });
      results.push({ name: t.name, medianMs, minMs });
      log(`  analise ${t.name}: mediana ${medianMs.toFixed(1)} ms (min ${minMs.toFixed(1)} ms)`);
    }
    return results;
  } finally {
    await stopServer(server);
  }
}

async function measureDownload() {
  const { server, port } = await startServer({ serveBuffer: content });
  try {
    const url = `http://127.0.0.1:${port}/file.bin`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-baseline-'));
    const out = path.join(tmp, 'out.bin');
    const results = [];
    for (const concurrency of [1, 8]) {
      const { medianMs } = await measureMs(async () => {
        fs.writeFileSync(out, Buffer.alloc(0));
        const r = await downloadParallelRanges({
          url,
          output: out,
          chunkCount: 16,
          concurrency,
          validateMedia: false,
          resume: false,
        });
        if (!r.ok) throw new Error(`download falhou: ${r.error || 'desconhecido'}`);
      });
      const mbps = (FILE_SIZE / (medianMs / 1000)) / (1024 * 1024);
      results.push({ concurrency, medianMs, mbps });
      log(
        `  download c=${concurrency}: mediana ${medianMs.toFixed(1)} ms (~${mbps.toFixed(2)} MB/s)`
      );
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    return results;
  } finally {
    await stopServer(server);
  }
}

async function measureCpuMemory() {
  const { server, port } = await startServer({ serveBuffer: content });
  try {
    const url = `http://127.0.0.1:${port}/file.bin`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-baseline-'));
    const out = path.join(tmp, 'out.bin');
    const cpuBefore = process.cpuUsage();
    const memBefore = process.memoryUsage();
    const t0 = process.hrtime.bigint();
    fs.writeFileSync(out, Buffer.alloc(0));
    const r = await downloadParallelRanges({
      url,
      output: out,
      chunkCount: 16,
      concurrency: 8,
      validateMedia: false,
      resume: false,
    });
    if (!r.ok) throw new Error(`download falhou: ${r.error || 'desconhecido'}`);
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const cpu = cpuDeltaMs(cpuBefore, process.cpuUsage());
    const memAfter = process.memoryUsage();
    fs.rmSync(tmp, { recursive: true, force: true });
    const result = {
      elapsedMs,
      cpuMs: cpu,
      cpuPct: (cpu / elapsedMs) * 100,
      rssMb: (memAfter.rss - memBefore.rss) / (1024 * 1024),
      heapUsedMb: (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024),
    };
    log(
      `  download 16 MiB c=8: ${elapsedMs.toFixed(0)} ms, CPU ${cpu.toFixed(1)} ms ` +
        `(${result.cpuPct.toFixed(1)}%), RSS +${result.rssMb.toFixed(1)} MB, heap +${result.heapUsedMb.toFixed(1)} MB`
    );
    return result;
  } finally {
    await stopServer(server);
  }
}

async function measureMux() {
  if (!checkFfmpeg()) {
    log('  mux: FFmpeg indisponivel — pulado (instale com npm run ffmpeg:install)');
    return null;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-baseline-'));
  const src = path.join(tmp, 'src.mp4');
  const out = path.join(tmp, 'out.mp4');
  const cmd = getFfmpegCommand();
  // Gera um clip de teste de 5s (testsrc + sine) e remuxa para MP4.
  const gen = spawnSync(
    cmd,
    ['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src],
    { windowsHide: true, encoding: 'utf8' }
  );
  if (gen.status !== 0 || !fs.existsSync(src)) {
    log('  mux: geracao do clip de teste falhou — pulado');
    fs.rmSync(tmp, { recursive: true, force: true });
    return null;
  }
  const { medianMs, minMs } = await measureMs(() => {
    const r = spawnSync(cmd, ['-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', out], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error('remux falhou');
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  log(`  mux (remux copy 5s): mediana ${medianMs.toFixed(0)} ms (min ${minMs.toFixed(0)} ms)`);
  return { medianMs, minMs };
}

async function main() {
  log('StreamGrab — Baseline do core (P11, secao 49)');
  log(`Plataforma: ${process.platform} | Node ${process.version}\n`);

  log('[1/4] Analise (providers locais)...');
  const analyze = await measureAnalyze();

  log('[2/4] Download (Range local, 16 MiB)...');
  const download = await measureDownload();

  log('[3/4] CPU/memoria (download 16 MiB, c=8)...');
  const cpuMem = await measureCpuMemory();

  log('[4/4] Mux (FFmpeg remux copy)...');
  const mux = await measureMux();

  const md = [
    '# Performance — Baseline do Core (P11)',
    '',
    '> Gerado automaticamente por `node tests/performance/baseline-core.mjs`.',
    `> **Ambiente:** ${process.platform} | Node ${process.version} | ${new Date().toISOString()}`,
    '',
    '## 1. Analise (tempo de `analyze` por provider, servidor local)',
    '',
    '| Alvo | Mediana | Minimo |',
    '|---|---|---|',
    ...analyze.map((a) => `| ${a.name} | ${a.medianMs.toFixed(1)} ms | ${a.minMs.toFixed(1)} ms |`),
    '',
    '## 2. Download (Range local, 16 MiB)',
    '',
    '| Concurrency | Mediana | Throughput |',
    '|---|---|---|',
    ...download.map((d) => `| ${d.concurrency} | ${d.medianMs.toFixed(1)} ms | ~${d.mbps.toFixed(2)} MB/s |`),
    '',
    '## 3. CPU / Memoria (download 16 MiB, c=8)',
    '',
    `- Tempo total: **${cpuMem.elapsedMs.toFixed(0)} ms**`,
    `- CPU: **${cpuMem.cpuMs.toFixed(1)} ms** (${cpuMem.cpuPct.toFixed(1)}% de um nucleo)`,
    `- RSS: **+${cpuMem.rssMb.toFixed(1)} MB** | Heap usado: **+${cpuMem.heapUsedMb.toFixed(1)} MB**`,
    '',
    '## 4. Mux (FFmpeg remux `-c copy`, clip 5s)',
    '',
    mux
      ? `| Mediana | Minimo |\n|---|---|\n| ${mux.medianMs.toFixed(0)} ms | ${mux.minMs.toFixed(0)} ms |`
      : '_FFmpeg indisponivel no momento da medicao — execute com `npm run ffmpeg:install`._',
    '',
    '## 5. Overhead do Electron',
    '',
    'Nao medivel em script headless. Acompanhe com o DevTools (Performance/Memory)',
    'durante analise e download na UI. O core (medido acima) e o mesmo usado pelo Electron.',
    '',
    '## 6. Metodologia',
    '',
    '- `RUNS = 5` medicao por item; reportada a **mediana** (robusta a ruido).',
    '- Servidores HTTP locais (127.0.0.1) — sem rede externa.',
    '- Conteudo de download deterministico (pseudo-aleatorio estavel entre execucoes).',
    '- Re-executavel: `node tests/performance/baseline-core.mjs`.',
    '',
  ].join('\n');

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, 'performance.md'), md);
  log('\nBaseline gravado em docs/performance.md');
}

main().catch((err) => {
  console.error('Falha ao gerar baseline:', err);
  process.exit(1);
});
