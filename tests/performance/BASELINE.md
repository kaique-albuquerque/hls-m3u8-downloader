# Baseline — Turbo Range (P6.2)

Data: 2026-08-12T13:35:04.904Z · Arquivo: 16 MiB · 
throttle: 1 MB/s agregado · latency: 80 ms

| c | normal (ms / MB/s / KB/s-conn) | throttle (ms / MB/s / KB/s-conn) | latency (ms / MB/s / KB/s-conn) |
|---|-------------------------------|--------------------------------|----------------------------------|
| 1 | 152 / 105.26 / 107789 | 17674 / 0.91 / 927 | 1556 / 10.28 / 10530 |
| 2 | 94 / 170.21 / 87149 | 19038 / 0.84 / 430 | 937 / 17.08 / 8743 |
| 4 | 123 / 130.08 / 33301 | 18158 / 0.88 / 226 | 506 / 31.62 / 8095 |
| 8 | 155 / 103.23 / 13213 | 18353 / 0.87 / 112 | 340 / 47.06 / 6024 |
| 12 | 130 / 123.08 / 10503 | 18586 / 0.86 / 73 | 381 / 41.99 / 3584 |
| 16 | 138 / 115.94 / 7420 | 19049 / 0.84 / 54 | 262 / 61.07 / 3908 |

## Leitura

- **normal**: o throughput total deve crescer com a concurrency até saturar (CPU/loop);
  o ganho por conexão extra diminui após o ponto de saturação.
- **throttle-1MBps**: o total fica limitado em ~1 MB/s; o throughput por conexão
  CAI proporcionalmente à concurrency → é o sinal que o Smart Turbo usa para reduzir.
- **latency-80ms**: com latência alta, mais conexões ajudam a esconder o overhead
  de round-trip por chunk; o ganho satura quando o pipeline fica cheio.
