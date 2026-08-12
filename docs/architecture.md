# Arquitetura do StreamGrab

> Documento vivo: diagramas de arquitetura + Registro de Decisões de Arquitetura (ADRs).
> Atualizado conforme o comportamento muda (regra 14 do plano de execução).

---

## 1. Visão geral

```
Electron ─┐
          ├─> StreamGrabCore / runCliSession ──> cli-flow
CLI ──────┘              │
          ProviderRegistry
                 │
      ┌──────────┼──────────┐
     HLS       DASH       YtDlp ── Direct / mdstrm
                 │
          DownloadEngine
                 │
      Transport Strategy (Range paralelo / HTTP / FFmpeg / curl-impersonate)
                 │
             FFmpeg (mux/remux/transcode)
                 │
              Output
```

## 2. Módulos e dependências

```
src/cli-flow.js            → cli/*, providers/registry, transports, ffmpeg, utils
src/core/                  → sem dependências internas (modelos, erros, logger,
                             filenames, eventos, engine, resume, session, smart-turbo)
src/providers/*            → core/models, core/errors, hls.js, dash.js, adapters/*
src/transports/*           → core/errors, core/resume, core/smart-turbo
src/cli/*                  → core, providers, transports, ffmpeg, utils
electron/main.js           → cli-flow.js (runCliSession) + security.js + media-info.js
electron/preload.cjs       → ponte IPC mínimo (contextBridge)
electron/renderer.js       → UI consumindo IPC (sem acesso ao Node)
```

- **Sem ciclos de import.**
- **Regra crítica:** o Electron não duplica lógica de download — ele roda o mesmo
  `runCliSession` do core com um `io` e um "answer book" adaptados (P2/P8).
- `src/legacy/*` (youtube signature) é **código morto em produção** — vivo apenas
  para testes; remoção pendente de migração dos testes (decisão 9).

## 3. Fluxo de dados

1. **Analyze** — URL → `ProviderRegistry.detect` (prioridade) → `provider.analyze`
   → `MediaInfo` normalizado (título, duração, formats[]).
2. **Download** — seleção de formato → `DownloadEngine` → estratégia de transporte:
   - mídia direta com `Accept-Ranges` → Range paralelo (turbo/smart-turbo, resume);
   - HLS/DASH → FFmpeg recebe a URL (mecanismo atual preservado);
   - plataformas/yt-dlp → yt-dlp como runner externo quando apropriado;
   - mdstrm → renovação de URL do player + curl-impersonate quando o CDN exige.
3. **Progresso** — event bus (`download:start/progress/speed/complete/error/...`)
   consumido por CLI (barra) e Electron (IPC) sem acoplar parsing de logs do FFmpeg.
4. **Conclusão** — mux/remux via FFmpeg (preferindo `-c copy`) → arquivo final
   (`.part` atômico quando aplicável) → histórico.

## 4. Modelos de domínio

```js
MediaInfo   { id, title, durationMs, thumbnail, sourceType, provider, formats[] }
Format      { id, label, resolution, videoCodec, audioCodec, container, bitrate,
              estimatedSize, hasVideo, hasAudio,
              kind: 'progressive' | 'adaptive' | 'video-only' | 'audio-only' }
DownloadJob { id, url, info, format, destination, strategy, state, progress, error? }
// estados: queued | analyzing | preparing | downloading | paused | merging |
//          converting | completed | failed | cancelled
```

## 5. Erros (seção 26 + 42)

- Taxonomia em `src/core/errors.js` com classe por cenário (rede, auth, 403, 429,
  URL expirada, DRM, FFmpeg, yt-dlp, disco, permissão, cancelamento).
- `classifyError()` centraliza a decisão de retry (nunca heurística na UI).
- **UX de falhas (P11):** `friendlyReport(err)` → `{ message, suggestedAction,
  detail, code, retryable }`; CLI e Electron renderizam
  **Motivo / Ação sugerida / [Detalhes]**.
- **Fallback ≠ bypass:** 401/403/DRM são terminais por classe — nunca viram loop
  de transports.

## 6. Segurança (seção 24)

- Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  preload CommonJS mínimo; validação de TODAS as mensagens IPC
  (`electron/security.js`); abertura de arquivos restrita a raízes registradas.
- Processos externos (FFmpeg/yt-dlp/curl) sempre com **argumentos estruturados**
  (nunca string de shell com entrada do usuário).
- Logging com **redação de secrets** (cookies, tokens, Authorization, URLs
  assinadas) em `src/core/logger.js`.
- Nunca implementar bypass de DRM (seção 43).

---

# ADRs — Registro de Decisões de Arquitetura

## ADR-001 — Versionamento 0.x durante a migração

**Status:** aceito (P1). Série `0.x` até a arquitetura estabilizar (`1.0.0` quando
considerada estável). `CHANGELOG.md` segue Keep a Changelog.

## ADR-002 — Test runner `node:test` nativo

**Status:** aceito (P0). Sem dependência adicional de runner; `npm test` roda
unit + integration + E2E.

## ADR-003 — Persistência em JSON com escrita atômica

**Status:** aceito (P7). SQLite reavaliado somente se houver necessidade real.
Escrita atômica (`.tmp` + `rename`) para settings, fila, histórico e resume.

## ADR-004 — yt-dlp como Provider/External Runner

**Status:** aceito (P3). Não reimplementar extractors; yt-dlp extrai metadados,
listas formatos e baixa quando fizer mais sentido. A UI nunca consome o JSON cru
do yt-dlp — dados normalizados no core.

## ADR-005 — Resume somente em HTTP Range/direct

**Status:** aceito (P6.1). HLS/DASH ficam fora do resume de chunks por design
(resume HLS/DASH = re-exec do FFmpeg). Integridade garantida por ETag/
Last-Modified/tamanho; URL assinada expirada → reanálise única, nunca concatena
parcial se o recurso mudou.

## ADR-006 — Electron seguro (`sandbox: true`)

**Status:** aceito (P8). `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, preload CommonJS, validação IPC completa.

## ADR-007 — Live HLS fora de escopo

**Status:** aceito. Live streams não são alvo nesta evolução.

## ADR-008 — Windows primeiro

**Status:** aceito (P10). `StreamGrab-Setup-<versão>.exe` (NSIS) primeiro; Linux/
macOS somente depois que a versão Windows estiver estável.

## ADR-009 — `src/legacy/*` removido somente após migração dos testes

**Status:** aceito. Código morto em produção, vivo só para testes; remoção
proposta após a migração dos testes dependentes.

## ADR-010 — P3 preserva o mecanismo de download HLS/DASH

**Status:** aceito. A migração de Providers normaliza arquitetura (MediaInfo/
Format), mas **não** introduz novo downloader de segmentos, retry granular ou
paralelismo de segmentos junto com o refactor (strangler pattern).

## ADR-011 — DownloadEngine compartilhado entre CLI e Electron

**Status:** aceito (P2/P8). O Electron não simula mais o terminal — ele roda o
mesmo `runCliSession` com `io`/answers adaptados; a fila é nativa do core.

## ADR-012 — Erros terminam por classe; fallback ≠ bypass

**Status:** aceito (P2.2/P4). `classifyError` decide retry; 401/403/DRM nunca
viram loop de transports.

## ADR-013 — Smart Turbo orientado por benchmark

**Status:** aceito (P6.2). Heurística nasce do baseline
(`tests/performance/BASELINE.md`): `perConnDropRatio 0.3`, janela sem dados não
pune, histerese de 2 janelas para subir, backoff 0.5× com cooldown; rollback por
`smartTurbo: false` / `--no-smart-turbo`. Nunca comportamento agressivo contra
servidores.

## ADR-014 — UX de falhas "Motivo / Ação sugerida / [Detalhes]"

**Status:** aceito (P11). Cada classe de erro carrega `suggestedAction`;
`friendlyReport()` gera o relatório plano para CLI e Electron; detalhe técnico
nunca substitui a mensagem amigável.

## ADR-015 — Sem TypeScript nesta migração

**Status:** aceito. Reavaliado após estabilizar contratos/testes/core/providers/
transports; se aprovado, migração incremental separada.
