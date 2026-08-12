# Performance — Baseline do Core (P11)

> Gerado automaticamente por `node tests/performance/baseline-core.mjs`.
> **Ambiente:** win32 | Node v22.15.0 | 2026-08-12T14:16:19.773Z

## 1. Analise (tempo de `analyze` por provider, servidor local)

| Alvo | Mediana | Minimo |
|---|---|---|
| HLS master | 4.5 ms | 2.6 ms |
| HLS media | 4.0 ms | 2.3 ms |
| DASH manifest | 1.5 ms | 0.7 ms |

## 2. Download (Range local, 16 MiB)

| Concurrency | Mediana | Throughput |
|---|---|---|
| 1 | 86.1 ms | ~185.88 MB/s |
| 8 | 72.5 ms | ~220.66 MB/s |

## 3. CPU / Memoria (download 16 MiB, c=8)

- Tempo total: **66 ms**
- CPU: **15.0 ms** (22.6% de um nucleo)
- RSS: **+17.2 MB** | Heap usado: **+1.1 MB**

## 4. Mux (FFmpeg remux `-c copy`, clip 5s)

| Mediana | Minimo |
|---|---|
| 40 ms | 37 ms |

## 5. Overhead do Electron

Nao medivel em script headless. Acompanhe com o DevTools (Performance/Memory)
durante analise e download na UI. O core (medido acima) e o mesmo usado pelo Electron.

## 6. Metodologia

- `RUNS = 5` medicao por item; reportada a **mediana** (robusta a ruido).
- Servidores HTTP locais (127.0.0.1) — sem rede externa.
- Conteudo de download deterministico (pseudo-aleatorio estavel entre execucoes).
- Re-executavel: `node tests/performance/baseline-core.mjs`.
