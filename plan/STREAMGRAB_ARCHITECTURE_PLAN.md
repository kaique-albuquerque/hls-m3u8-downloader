# StreamGrab — Plano de Implementação por Partes (Revisão 2)

> Documento gerado a partir da análise profunda de `plan/goal/architect.md`, da auditoria do código real (`src/`, `electron/`, `scripts/`, testes) e das decisões aprovadas em `plan/goal/awnser.md`.
>
> **Status: PLANO REVISADO — nenhum arquivo de código foi alterado. Aguardando aprovação final para iniciar a P0.**

---

## 0. Resumo Executivo

O `architect.md` define 54 seções de evolução do projeto. Elas foram agrupadas em **Partes de implementação** com uma nova ordem, revisada conforme `awnser.md`.

Princípios desta revisão:

1. **Arquitetura antes de otimização.** O objetivo é um StreamGrab arquiteturalmente sólido e utilizável. Resume (P6.1) e Smart Turbo (P6.2) ficam para **depois** do produto desktop funcional (Core → Providers → Transports → FFmpegService → Queue/Settings → Electron → installer Windows).
2. **Normalização arquitetônica ≠ mudança de mecanismo de download.** Na migração de Providers (P3), HLS/DASH mantêm o mecanismo atual (FFmpeg). Não se introduz novo downloader de segmentos, retry granular, paralelismo de segmentos ou resume junto com o refactor.
3. **Strangler pattern real.** Nada de código antigo removido antes do substituto testado, compatível, com consumidores migrados e sem referências restantes.
4. **P2 subdividida** em P2.1–P2.6, cada uma com testes e critérios de aceitação próprios.
5. **STOP obrigatório após cada Parte**, com relatório padronizado de 12 itens e aprovação explícita do usuário.

O maior acoplamento do projeto hoje: **o Electron não tem API própria — ele simula respostas de terminal dentro do `runCliSession`** (`createAnswerBook` em `electron/main.js`). A P2 resolve isso extraindo a orquestração do `cli-flow.js` para um `StreamGrabCore` consumível por CLI e Electron igualmente.

---

## 1. Decisões Aprovadas (Resolvidas)

### 1.1 Decisões arquitetônicas (awnser.md §1)

| # | Decisão | Resolução |
|---|---|---|
| 1 | Versionamento | Voltar para série **0.x** durante a migração |
| 2 | Test runner | **`node:test`** nativo — sem dependência adicional desnecessária |
| 3 | Persistência | **JSON + escrita atômica**; SQLite reavaliado futuramente somente se houver necessidade real |
| 4 | yt-dlp | **Provider/External Runner** — usado para extração e/ou download quando fizer mais sentido; não reimplementar extractors |
| 5 | Resume HLS/DASH | **NÃO implementar** nesta evolução; resume concentra-se em HTTP Range/direct onde a integridade é garantível |
| 6 | Electron | Objetivo final: `contextIsolation: true`, `nodeIntegration: false`, **`sandbox: true`** — migração testada, sem quebrar o preload |
| 7 | Live HLS | **Fora de escopo** neste momento |
| 8 | Plataforma | **Windows primeiro**; Linux/macOS somente depois que a versão Windows estiver estável |
| 9 | `src/legacy/*` | Remover **somente depois** que os testes que dependem dele forem migrados e houver confirmação de que nenhuma funcionalidade de produção depende dele |

### 1.2 Regras de execução aprovadas (awnser.md §2–§17)

- **P2 subdividida** em P2.1–P2.6 (ordem ajustável se a análise do código justificar, com explicação prévia).
- **Não reinventar o download HLS/DASH** na migração de Providers — separar normalização arquitetônica de mudança de mecanismo.
- **Migração ≠ otimização**: Smart Turbo é otimização → fica para depois do produto desktop.
- **STOP após cada Parte** + relatório de 12 itens (seção 24).
- **Strangler pattern real em 6 passos** (seção 22).
- **Sem abstrações prematuras** — só criar abstração que resolva problema concreto encontrado no código.
- **Sem TypeScript agora** — reavaliar depois de estabilizar arquitetura, contratos, testes, core, providers e transports.
- **CLI atual não quebra** — evolução aditiva; flags existentes preservadas até existir substituto + testes de compatibilidade.
- **Redação de secrets obrigatória** com testes específicos (URLs assinadas, query params sensíveis, cookies, Authorization, Referer sensível, logs de yt-dlp/FFmpeg/curl).
- **Fallback ≠ bypass** — classificar erros; 401/403/DRM nunca viram loop de transports.
- **P0 obrigatório antes de qualquer refactor** (characterization tests).
- **Sem cobertura artificial** — testar comportamento e fronteiras importantes, não perseguir % de coverage.
- **`StreamGrab-Setup.exe` primeiro**, funcional em máquina Windows limpa (sem Node.js/FFmpeg/yt-dlp manuais).
- **Smart Turbo orientado por benchmark** — baseline, throughput, overhead, tamanhos, latências, throttling; a heurística nasce dos testes, não de suposição.
- **Prioridade da migração**: 1. Correção, 2. Segurança, 3. Testes, 4. Arquitetura, 5. Confiabilidade, 6. UX, 7. Distribuição, 8. Performance, 9. Novas features.

---

## 2. Nova Ordem das Partes

| Ordem | Parte | Seções do architect.md | Tema | Complexidade |
|---|---|---|---|---|
| 1 | **P0** | 28, 29, 31 | Regression/characterization tests + runner + lint/format | Baixa–média |
| 2 | **P1** | 2, 32 | Branding (StreamGrab) + SemVer 0.x + CHANGELOG | Baixa |
| 3 | **P2.1** | 5 (modelos) | Domain Models: MediaInfo, Format, DownloadJob, estados | Média |
| 4 | **P2.2** | 26, 27, 23 | Errors (taxonomia) + Logger (redação) + Filenames | Média |
| 5 | **P2.3** | 6 | Event System (event bus de progresso) | Baixa–média |
| 6 | **P2.4** | 45 | StreamGrabCore — fachada pública | Média |
| 7 | **P2.5** | 5, 25 | DownloadEngine (ciclo de vida do job) | Média–alta |
| 8 | **P2.6** | 10, 48 | Adaptação da CLI ao novo Core (sem quebrar fluxo atual) | Média–alta |
| 9 | **P3** | 3, 4, 9, 17, 18, 19 | ProviderRegistry + Providers normalizados (HLS/DASH **sem** mudar mecanismo de download) | Média–alta |
| 10 | **P4** | 15, 16, 39, 40, 41 | Transports básicos + strategy selection + retries + limites | Alta |
| 11 | **P5** | 20, 11 | FFmpegService central + áudio (remux/copy/transcode) | Média |
| 12 | **P7** | 10, 12, 21, 22, 46, 37, 38 | Queue + Settings + History + Persistence | Média–alta |
| 13 | **P8** | 8, 24 | Nova interface Electron + segurança (sandbox: true) | Muito alta |
| 14 | **P10** | 7, 30 | Windows installer (StreamGrab-Setup.exe) + CI/Releases essencial | Média–alta |
| 15 | **P9** | 44 | CLI evoluída (`analyze`, `download`) — aditiva | Média |
| 16 | **P6.1** | 13 | Resume para downloads compatíveis (HTTP Range/direct) | Alta |
| 17 | **P6.2** | 14 | Smart Turbo (orientado por benchmark) | Alta |
| 18 | **P11** | 34, 35, 36, 42, 43, 49 | Docs, maturidade, performance, refinamentos | Baixa–média |

**Justificativa das mudanças de ordem em relação à v1:**

- **P6 (Resume/Smart Turbo) movida para depois de P10/P9**: são otimização/gerenciamento e exigem o produto desktop estável para validação real. P6.1 (Resume) vem antes de P6.2 (Smart Turbo) porque o Smart Turbo depende de resume/integridade e de benchmark.
- **P10 (installer) antes de P9 (CLI)**: um `StreamGrab-Setup.exe` funcional valida a experiência de produto em máquina limpa antes da evolução da CLI; a CLI antiga continua funcionando nesse meio-tempo (compatibilidade preservada).
- **P2 subdividida**: evita o grande refactor simultâneo; cada subparte é testável isoladamente e a ordem P2.1→P2.6 segue a cadeia de dependências (modelos → infra → eventos → fachada → engine → consumidor).
- **P11 por último**: docs/refinamentos refletem o estado final do código.

---

## 3. Auditoria do Estado Atual (base para o plano)

### 3.1 Arquitetura atual

```
src/index.js (CLI entry)          electron/main.js (Electron entry)
        │                                  │
        └─────────────► cli-flow.js ◄──────┘  ← god module (orquestra tudo)
                              │
        ┌─────────────────────┼──────────────────────┐
        ▼                     ▼                      ▼
 source-adapters.js      cli/download.js        cli/curl-flow.js
 (registry fino)         cli/turbo.js           cli/ui.js, cli/progress.js
        │                     │                      │
   adapters/             ffmpeg.js              curlimp.js + mdstrm.js
   youtube.js  ─┐             │                      │
   social.js   ─┼─► ytdlp.js  ▼                      ▼
   hls/dash/direct (em source-adapters.js)      hls.js (parse)
```

### 3.2 Fluxo atual (CLI e Electron são o mesmo)

1. Cola a URL → `normalizeUrl` → `resolveSourceAdapterAsync` (detecta youtube/social/hls/dash/direct, com probe de Content-Type para URL sem extensão).
2. `analyze()` por adaptador → shapes diferentes: HLS devolve `{kind:'master', variants[]}`, DASH devolve `videoRepresentations[]`, yt-dlp devolve `variants[]` com URI mágica `ytdlp-format:ID`.
3. `chooseVariant` (CLI pergunta; Electron responde via `createAnswerBook`).
4. `prepareDownload()` → resolve a URL final (`{downloadUrl}` ou `{strategy:'mux', videoUrl, audioUrl}`).
5. Download: fluxo normal (FFmpeg `-c copy` → fallbacks), turbo (range paralelo), mux (vídeo+áudio separados), ou curl-flow (segmentos + chaves + rewrite da playlist + FFmpeg concat).
6. Progresso: `createProgressReporter` (barra CLI ou eventos IPC).

### 3.3 Principais problemas encontrados (dívida técnica)

| # | Problema | Impacto |
|---|---|---|
| 1 | **Electron simula o CLI** (`createAnswerBook` + `createElectronIo`) | Toda feature de UI depende de strings de prompt do CLI; fragilidade alta; impossível fila/multidownload nativo |
| 2 | **`cli-flow.js` é god module** (~320 linhas de orquestração + prompts) | Core não reutilizável, lógica de fallback hardcoded |
| 3 | **Adaptadores com shapes heterogêneos** | Nada de MediaInfo/Format normalizado; UI não consegue listar formatos de forma uniforme |
| 4 | **HLS/DASH delegados 100% ao FFmpeg** | Sem progresso por segmento, sem retry granular, sem resume; apenas `curl-flow` faz segmento a segmento |
| 5 | **Sem taxonomia de erros** (strings soltas) | UX de falha pobre; Electron recebe `error` como string |
| 6 | **Sem persistência** (fila, histórico, settings, resume metadata) | Nada sobrevive a restart |
| 7 | **Turbo fixo** (8 chunks, sem ETag/Last-Modified, sem adaptação) | Sem Smart Turbo, sem resume |
| 8 | **Sem test runner** (scripts soltos, `npm test` roda só E2E) | Refactor sem rede de segurança |
| 9 | **`src/legacy/*` (youtube signature) vivo só para testes** | Código morto em produção; remover quando os testes forem migrados |
| 10 | **Sem packaging** (sem electron-builder, CI, releases) | Não é instalável |
| 11 | **`sandbox: false` + sem CSP no Electron** | Auditoria de segurança pendente |
| 12 | **Config sem escrita** (`config.json` só lido) | Settings de usuário não persistem na UI |

### 3.4 Mapa de dependências (quem importa quem)

```
cli-flow.js          → cli/*, hls.js, ffmpeg.js, source-adapters.js, utils.js, adapters/*
electron/main.js     → cli-flow.js, curlimp.js, hls.js, mdstrm.js, source-adapters.js, cli/config.js
source-adapters.js   → hls.js, dash.js, utils.js, adapters/youtube.js, adapters/social.js
adapters/{youtube,social}.js → adapters/ytdlp.js
cli/curl-flow.js     → curlimp.js, hls.js, mdstrm.js, cli/download.js, cli/ui.js
cli/turbo.js         → ffmpeg.js, cli/download.js, cli/progress.js
cli/download.js      → ffmpeg.js, cli/progress.js, cli/ui.js
ffmpeg.js / hls.js / dash.js / utils.js / curlimp.js / mdstrm.js → apenas node internals
legacy/*             → SOMENTE test-curl-e2e.mjs
```

- **Ciclos de import:** nenhum.
- **Acoplamento funcional:** `electron/main.js` → `cli-flow.js` → todos os fluxos (é o ciclo real a quebrar na P2).

---

## 4. Arquitetura Alvo

```
Electron ─┐
          ├─> StreamGrabCore (fachada pública — analyze/enqueue/download/cancel/...)
CLI ──────┘
               │
        ProviderRegistry
               │
      ┌────────┼─────────┐
     HLS      DASH     YtDlp ── Direct / mdstrm
               │
        DownloadEngine
               │
     Transport Strategy (básicos na P4 → resume/smart na P6)
               │
           FFmpeg
               │
            Output
```

**Modelos de domínio (contratos, criados na P2.1):**
```js
MediaInfo { id, title, durationMs, thumbnail, sourceType, provider, formats[] }
Format    { id, label, resolution, videoCodec, audioCodec, container, bitrate,
            estimatedSize, hasVideo, hasAudio, kind: 'progressive'|'adaptive'|'video-only'|'audio-only' }
DownloadJob { id, url, info, format, destination, strategy, state, progress, error? }
// estados: queued | analyzing | preparing | downloading | paused | merging | converting | completed | failed | cancelled
```

---

## 5. Arquitetura de Providers

**Contrato de Provider (evolução do contrato atual dos adapters):**
```js
Provider {
  id: 'hls' | 'dash' | 'direct' | 'ytdlp' | ...
  label: string
  priority: number            // ordem de detecção
  detect(input: UrlInput): boolean | { score }
  analyze(input, context): Promise<MediaInfo>
  getFormats(media): Format[]
  prepareDownload(selection, context): Promise<PreparedDownload>
}
```

**Regra central da P3 (awnser.md §3):** separar **normalização arquitetônica** de **mudança do mecanismo de download**.

```
HlsProvider → Analyze → MediaInfo → Formats → PreparedDownload → mecanismo HLS atual (FFmpeg)
```

O mecanismo atual que já funciona (FFmpeg para HLS/DASH, curl-flow para mdstrm, turbo/mux para diretas) é **preservado**. Melhorias de download (retry granular, paralelismo de segmentos, resume HLS) são propostas separadamente depois que Registry + Core + Transports estiverem estáveis.

---

## 6. Arquitetura de Transports

Separação de responsabilidades:

- **Source** (O QUE se baixa): HLS, DASH, Direct, YtDlp.
- **Transport** (COMO os bytes chegam): HTTP sequencial, ParallelRange, CurlImpersonate, YtDlpRunner.
- **Muxer/Processor** (COMO combinar): FFmpeg.

**Na P4 implementa-se apenas o conjunto básico:** HTTP sequencial, ParallelRange (herdado do turbo atual, sem adaptação), CurlImpersonate (preservado), seletor de estratégia com fallback **por classe de erro** e retries com backoff.

**Fallback ≠ bypass (awnser.md §12):**
- `403/401/DRM/URL expirada` → terminais. Nunca loop de transports.
- `timeout/reset/429/5xx` → retry de transporte com backoff.
- yt-dlp só assume o download quando é a opção correta para a fonte (não como tentativa de contornar bloqueio de transporte).

---

## 7. Download Engine e Eventos

- `DownloadEngine` recebe um job e emite eventos de progresso; **não depende de CLI nem de Electron**.
- Event bus: `download:start | progress | speed | eta | pause | resume | complete | error | cancel`.
- O payload de progresso inclui: bytes baixados, bytes totais, %, velocidade, ETA, etapa atual, nº de chunks, status do mux.
- A UI nunca parseia logs do FFmpeg diretamente (progresso vem dos eventos do engine).

---

## 8. Fila, Persistência, Settings e Histórico

- **Persistência:** JSON + escrita atômica (aprovado). Versionado (`{version: 1}`). SQLite reavaliado futuramente só se houver necessidade real.
- **Fila:** estados, limite de simultâneos, cancelar/retry/pausar/remover/reordenar, abrir arquivo/pasta. Crash recovery: revalidar jobs ao abrir.
- **Settings:** pasta padrão, simultâneos, turbo (on/off + limite), qualidade padrão, áudio, notificações, tema, comportamento ao concluir, retenção de histórico.
- **Histórico:** local, controlável pelo usuário (limpar/remover). Privacidade: dados locais.
- **Disco/atômico:** checagem de espaço antes de downloads grandes (incl. temporário extra p/ mux) + download em `.part` com rename somente após validação.

---

## 9. Electron (objetivo de segurança)

- Estado atual: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, sem CSP.
- **Objetivo final aprovado:** `contextIsolation: true`, `nodeIntegration: false`, **`sandbox: true`** — migração testada, sem quebrar o preload.
- Renderer consome apenas a API exposta pelo preload (nunca módulos internos).
- IPC com validação de payload; `shell.openExternal` restrito a `http/https`; spawn sempre com args estruturados; CSP ativa.

---

## 10. CLI

- **Compatibilidade garantida:** o fluxo atual continua funcionando durante toda a migração.
- A nova CLI é **aditiva**: `streamgrab <url>`, `streamgrab analyze <url>`, `streamgrab download <url> [--audio-only] ...`.
- Flags existentes (`--curl-impersonate`, `--youtube`, `--turbo`, `--chunks`, `--cookies`, `--cookies-from-browser`) só saem quando houver substituto equivalente + testes de compatibilidade.

---

## 11. Segurança e Redação de Secrets (awnser.md §11)

Campos que **nunca** podem aparecer em logs persistidos:
- URLs assinadas completas (query params sensíveis: `token`, `access_token`, `sid`, `signature`, `key`, `jwt`, etc.);
- cookies;
- headers `Authorization`;
- `Referer` quando contiver informação sensível;
- stderr do yt-dlp / FFmpeg / curl.

Ações: centralizar redação no logger do core (reusar `maskUrl`), aplicar a stderr de processos externos, e **criar testes específicos de redaction** na P2.2.

---

## 12. Modelo de Erros

Taxonomia: `UnsupportedSourceError`, `NetworkError`, `ForbiddenError`, `RateLimitError`, `ExpiredUrlError`, `MediaNotFoundError`, `FFmpegError`, `YtDlpError`, `DiskSpaceError`, `PermissionError`, `UnsupportedDrmError`, `CancelledError`, `RangeNotSupportedError`.

Cada erro carrega: classe, mensagem amigável, detalhe técnico (separado), e **retryability** (transitório vs permanente) — usado pelo fallback/retry sem virar bypass.

---

## 13. Estratégia de Testes

**P0 é obrigatório antes de qualquer refactor.** Characterization tests para (awnser.md §13):
- HLS atual (parse master/media/keys/maps/byterange, fluxo FFmpeg);
- DASH atual;
- direct download;
- yt-dlp (mock do JSON);
- mux vídeo + áudio;
- turbo/range (servidor local com Range);
- curl-impersonate (curl fake dos E2E atuais);
- Media Stream/mdstrm;
- cancelamento;
- filename sanitation;
- headers;
- comportamento atual da CLI (exit codes, flags).

Regras: **fixtures locais e servidores HTTP locais** sempre que possível; nenhuma dependência exclusiva de sites externos; **sem cobertura artificial** — priorizar comportamento e fronteiras arquitetônicas importantes.

---

## 14. CI/CD e Releases

- **CI essencial (P10):** em PRs — install, lint, unit tests, integration tests, build Electron.
- **Releases (P10):** tags → build Windows → `StreamGrab-Setup.exe` + portable → checksums → GitHub Release. Publicação sempre manual/explícita (nunca automática sem definição de segurança).
- **Meta Windows primeiro:** instalador funcional em máquina limpa (sem Node.js/FFmpeg/yt-dlp manuais). Linux/macOS depois.
- **Auto-update (seção 33):** NÃO nesta evolução — só depois de releases confiáveis e estratégia de assinatura definida.

---

## 15. Partes de Implementação (detalhado)

---

### PARTE 0 — Regression/Characterization Tests (seções 28, 29, 31)

**Objetivo:** congelar o comportamento atual ANTES de qualquer refactor; estabelecer runner `node:test` e lint/format.

**Arquivos novos:**
- `tests/unit/` — hls-parse.test.js, dash-parse.test.js, utils.test.js (URL/mask/sanitize/headers), source-detection.test.js, chunk-planning.test.js, filename.test.js, redaction.test.js
- `tests/integration/` — range-server.test.js (servidor HTTP local com Range), ffmpeg.test.js, mux.test.js, ytdlp.test.js (mock), curl-impersonate.test.js (curl fake)
- `tests/e2e/` — mover `test-curl-e2e.mjs` e `smoke-*.mjs` para cá com adaptação mínima
- `tests/fixtures/` — playlists HLS (master/media/AES-128/EXT-X-MAP/BYTERANGE), MPDs DASH, exemplos de JSON do yt-dlp
- `eslint.config.js`, `.prettierrc`, `.editorconfig`

**Arquivos alterados:**
- `package.json` — scripts `test`, `test:unit`, `test:integration`, `lint`, `format`; devDeps somente se `node:test` for insuficiente (aprovado: `node:test` nativo)

**Dependências:** nenhuma runtime; dev apenas lint/format.

**Riscos:** testes de caracterização podem "congelar" bugs — revisar asserts contra comportamento desejado, não só o atual.

**Testes / Critérios de aceitação:**
- `npm test` roda a suíte completa com exit 0 (unit + integration + e2e).
- Cobertura de comportamento (não métrica) para todos os fluxos listados na seção 13.
- Testes não dependem de sites externos (fixtures + servidores locais).
- Nenhum arquivo de produção alterado.

**Rollback:** reversível — apenas adição de arquivos e scripts.

**Complexidade:** baixa–média.

---

### PARTE 1 — Branding e Versionamento (seções 2, 32)

**Objetivo:** migrar identidade para **StreamGrab** e adotar SemVer **0.x**.

**Arquivos alterados:**
- `package.json` — `name: "streamgrab"`, `description` ("Universal video downloader for HLS, DASH, YouTube and supported web platforms."), keywords
- `package-lock.json` — regenerado pelo `npm install`
- `electron/main.js` — `title: 'StreamGrab'`
- `electron/index.html` — título da janela/UI
- `README.md` — reescrita inicial (versão completa na P11)
- `config.example.json` — comentários com nome novo

**Arquivos novos:** `CHANGELOG.md`

**Decisão SemVer (aprovada):** série `0.x` durante a migração, ex. `0.1.0` após a P2, `0.2.0` após a P7, `1.0.0` quando estável e instalável.

**Não fazer:** renomear identificadores internos (funções, módulos) só por branding.

**Riscos:** baixo.

**Critérios de aceitação:** nenhuma referência a "video-downloader"/"HLS-only" no título/descrição; `npm run electron:dev` abre "StreamGrab".

**Rollback:** trivial (git revert).

**Complexidade:** baixa.

---

### PARTE 2 — Domain, Core, Events, Errors (subdividida: P2.1–P2.6)

Cada subparte tem **testes e critérios de aceitação próprios** e é implementada isoladamente, na ordem abaixo.

#### P2.1 — Domain Models

**Objetivo:** criar os modelos `MediaInfo`, `Format`, `DownloadJob` e os estados do job (sem lógica de download).

**Arquivos novos:** `src/core/models.js` (ou `src/core/domain.js`), `tests/unit/core-models.test.js`

**Testes / Critérios:** validação de shape dos modelos; transições de estado válidas/inválidas do job; serialização limpa (sem campos circulares).

**Rollback:** módulo novo, nada depende dele ainda.

#### P2.2 — Errors, Logger e Filenames

**Objetivo:** taxonomia de erros (seção 12), logger com redação de secrets e política central de filenames.

**Arquivos novos:** `src/core/errors.js`, `src/core/logger.js`, `src/core/filenames.js`, testes unitários dos três (incl. **redaction.test.js**).

**Testes / Critérios:**
- Cada erro: classe + mensagem amigável + detalhe técnico + retryability.
- Logger: URLs assinadas, cookies, Authorization e stderr de processos externos aparecem redigidos; teste específico para cada caso.
- Filenames: chars inválidos Windows, nomes reservados, Unicode, comprimento, colisões `Video (1).mp4`, path traversal bloqueado.

**Rollback:** módulos novos; nenhum consumidor ainda.

#### P2.3 — Event System

**Objetivo:** event bus tipado de progresso (seção 7), sem dependência de UI.

**Arquivos novos:** `src/core/events.js`, testes unitários (subscribe/emit/once/off, payloads, erros em handlers não derrubam o emissor).

**Critérios:** eventos `start/progress/speed/eta/pause/resume/complete/error/cancel`; payload padronizado.

#### P2.4 — StreamGrabCore (fachada pública)

**Objetivo:** fachada `StreamGrabCore` com `analyze`, `enqueue`, `download`, `pause`, `resume`, `cancel`, `getQueue`, `getHistory` — inicialmente delegando aos adapters existentes.

**Arquivos novos:** `src/core/registry.js` (fachada), `src/core/index.js`, testes.

**Critérios:** a fachada **não importa nada de `cli/` nem de `electron/`**; CLI e um harness de teste consomem a mesma API.

#### P2.5 — DownloadEngine

**Objetivo:** ciclo de vida do job (queued → analyzing → preparing → downloading → … → completed/failed/cancelled) emitindo eventos da P2.3.

**Arquivos novos:** `src/core/engine.js`, testes com mocks de "executor".

**Critérios:** cancelamento interrompe; erro mapeado para classe da P2.2; estado consistente em cada transição; nenhuma referência a console/readline/IPC.

#### P2.6 — Adaptação da CLI ao novo Core

**Objetivo:** `cli-flow.js` passa a consumir `StreamGrabCore` (strangler), **sem mudar o comportamento observável da CLI**.

**Arquivos alterados:** `src/cli-flow.js` (camada de prompts + mapeamento de eventos → terminal), `src/index.js` (sem mudança de flags).

**Critérios:** os E2E existentes de CLI (incl. `test-curl-e2e.mjs`) passam sem alteração de expectativas; flags e exit codes idênticos.

**Riscos P2:** alto — refactor central. Mitigação: P0 obrigatória; cada subparte é testável e reversível isoladamente; o fluxo antigo permanece até P2.6 validar.

**Rollback P2:** `cli-flow.js` original preservado; reverter é apontar o entry de volta.

---

### PARTE 3 — ProviderRegistry + Providers Normalizados (seções 3, 4, 9, 17, 18, 19)

**Objetivo:** formalizar o contrato de Provider, criar o `ProviderRegistry` e normalizar `MediaInfo`/`Format` para todas as fontes.

**Regra crítica (awnser.md §3):** NÃO reinventar o download HLS/DASH nesta parte. A migração é arquitetônica:

```
HlsProvider → Analyze → MediaInfo → Formats → PreparedDownload → mecanismo HLS atual (FFmpeg/curl-flow)
DashProvider → idem → FFmpeg atual
DirectProvider / YtDlpProvider → mecanismos atuais (turbo/mux)
```

**Arquivos novos:**
- `src/providers/registry.js` — `ProviderRegistry` (prioridades, fallback de detecção, probe por Content-Type, URL desconhecida)
- `src/providers/hls/index.js` — provider HLS normalizado (envole `src/hls.js` + `mdstrm.js` como estratégia de URL; download via FFmpeg atual)
- `src/providers/hls/drm.js` — detecta `EXT-X-SESSION-KEY`/`EXT-X-KEY` com METHOD fora de AES-128 → erro claro (sem contornar)
- `src/providers/dash/index.js` — provider DASH normalizado (envole `src/dash.js`; download via FFmpeg atual)
- `src/providers/dash/drm.js` — `ContentProtection` → erro claro (sem contornar Widevine/PlayReady)
- `src/providers/direct/index.js`
- `src/providers/ytdlp/index.js` — migra de `src/adapters/ytdlp.js`; normaliza JSON do yt-dlp para `MediaInfo`/`Format` **sem vazar shape cru**

**Arquivos alterados:**
- `src/source-adapters.js` → delegado ao `ProviderRegistry` (mantido como fachada de compatibilidade)
- `src/hls.js`, `src/dash.js` → implementações internas dos providers (export público preservado)
- `src/adapters/youtube.js`, `src/adapters/social.js` → seletores do provider `ytdlp`

**Não faz parte da P3** (adiar para proposta futura): downloader de segmentos HLS próprio, retry granular, paralelismo de segmentos, resume HLS.

**Riscos:** médio — coexistência de providers novos com adapters antigos até a P4.

**Testes / Critérios:**
- `registry.detect(url)` retorna o provider correto para cada fixture.
- HLS/DASH: `analyze` → `MediaInfo`/`Format` normalizados; DRM → erro claro.
- yt-dlp: mock do JSON → `MediaInfo` normalizado (sem `format_id` cru na UI).
- E2E existentes continuam passando (mecanismo de download intacto).

**Rollback:** providers coexistem com adapters antigos; desligar via flag.

**Complexidade:** média–alta.

---

### PARTE 4 — Transports Básicos + Strategy Selection (seções 15, 16, 39, 40, 41)

**Objetivo:** separar Source de Transport; seleção de estratégia e fallback **por classe de erro**; retries/backoff; limites de recursos.

**Arquivos novos:**
- `src/transports/http.js` — sequencial (herda `cli/download.js`), detecta `Accept-Ranges`
- `src/transports/range.js` — paralelo por Range (herda `cli/turbo.js` atual, **sem** adaptação/smart; valida `Content-Range`, detecta HTML/JSON no lugar de mídia)
- `src/transports/curl.js` — `CurlImpersonateTransport` (herda `curlimp.js` + `curl-flow.js`): headers, cookies, referer, perfil, cancelamento, cleanup, timeouts
- `src/transports/ytdlp-runner.js` — executa download via yt-dlp somente quando é a opção correta
- `src/core/strategy.js` — seletor + fallback por classe de erro (sem loop 403)
- `src/core/retry.js` — backoff exponencial + jitter; respeita `Retry-After`; erros permanentes nunca retentados
- `src/core/resources.js` — limites: downloads simultâneos, conexões por download, processos FFmpeg, temporários

**Arquivos alterados:**
- `src/cli/turbo.js`, `src/cli/download.js`, `src/cli/curl-flow.js` → delegam aos transports (API atual mantida)

**Riscos:** médio — fallback pode mascarar auth/DRM; mitigado pela classificação de erros da P2.2.

**Testes / Critérios:**
- Servidor local: com/sem Range, 403, 429, resposta HTML no lugar de mídia.
- Fallback: range→sequencial sem Range; 403 **não** dispara loop de transports.
- Backoff respeita `Retry-After`; limites de recursos respeitados.

**Rollback:** `cli-flow` pode voltar aos fluxos antigos via `STREAMGRAB_LEGACY_FLOW=1`.

**Complexidade:** alta.

---

### PARTE 5 — FFmpegService e Áudio (seções 20, 11)

**Objetivo:** centralizar FFmpeg; diferenciar remux/copy/transcode; suporte a áudio-only.

**Arquivos novos:**
- `src/ffmpeg/service.js` — `FfmpegService`: detectar binário (vendor/ffmpeg ou PATH), executar, progresso (eventos), cancelamento, cleanup
- `src/ffmpeg/muxer.js` — remux (`-c copy`), mux vídeo+áudio, conversão de áudio
- `src/ffmpeg/audio.js` — perfis: original/best, M4A, MP3, Opus, FLAC (quando fizer sentido); regras "exige transcode" vs "só remux"

**Arquivos alterados:**
- `src/ffmpeg.js` → re-export fino (compat até P5 validar)
- `src/cli/download.js` (modos copy/adtstoasc/aac → muxer), `src/cli/turbo.js` (`startMuxDownload` → `muxer.mux`), `src/cli/curl-flow.js` (concat → `muxer`)

**Riscos:** médio — modos FFmpeg sem quebrar HLS real; mitigado pelos E2E com HLS real.

**Testes / Critérios:**
- Remux de fixture via `FfmpegService`; progresso via eventos (sem parse de log na UI).
- `audio-only mp3` gera MP3 válido; `original` faz copy sem recodificar.
- Cancelamento mata processo filho (sem órfão) e limpa `.part`.

**Rollback:** `src/ffmpeg.js` original mantido até E2E novos passarem.

**Complexidade:** média.

---

### PARTE 7 — Queue + Settings + History + Persistence (seções 10, 12, 21, 22, 46, 37, 38)

**Objetivo:** gerenciamento de downloads com persistência local (JSON atômico) e suporte a playlists.

**Arquivos novos:**
- `src/core/queue.js` — `DownloadQueue`: estados, limite de simultâneos, cancelar/retry/pausar/remover/reordenar, abrir arquivo/pasta
- `src/core/history.js` — histórico local (título, URL, provider, formato, destino, data, status, tamanho, duração); abrir/baixar de novo/copiar URL/remover/limpar
- `src/core/settings.js` — settings persistidos (pasta padrão, simultâneos, turbo on/off + limite, qualidade padrão, áudio, notificações, tema, comportamento ao concluir, retenção de histórico)
- `src/core/storage.js` — JSON + escrita atômica (`.tmp` + rename), versionado (`{version: 1}`)
- `src/core/disk.js` — espaço disponível antes de downloads grandes (incl. temporário extra p/ mux)
- `src/core/atomic.js` — download em `.part`, valida, renomeia

**Arquivos alterados:**
- `src/core/engine.js` — integra fila/histórico/settings/disk/atomic
- `src/cli/config.js` — funde config.json legado com `settings.js`

**Riscos:** médio — crash recovery da fila (revalidar jobs ao abrir).

**Testes / Critérios:**
- Fila: limite respeitado; cancelar/retry; ordem preservada.
- Playlist (yt-dlp): lista, seleção, qualidade padrão, colisão de nomes resolvida.
- Storage: escrita atômica (crash simulado → arquivo anterior intacto).
- Disk: `DiskSpaceError` amigável; Histórico: privacidade + limpar.

**Rollback:** storage versionado; downgrade ignora campos novos.

**Complexidade:** média–alta.

---

### PARTE 8 — Electron: Nova UI e Segurança (seções 8, 24)

**Objetivo:** UI real (Analyze → formatos → fila → progresso → abrir/localizar) consumindo o core via IPC; migração para `sandbox: true` com testes.

**Fluxo novo:**
```
URL → Analyze → MediaInfo (título, thumbnail, duração, provider, protocolo)
→ lista Format (resolução, codec, container, bitrate, tamanho estimado, áudio)
→ seleção + opções → enfileirar → progresso por job → concluído (abrir/localizar)
```

**Arquivos novos:**
- `electron/ui/` — componentes de UI (estilo a decidir no início da P8 — ver seção 19)
- `electron/ipc.js` — handlers com **validação de payload** (nunca confiar no renderer)
- `electron/security.js` — CSP; `shell.openExternal` restrito a `http/https`; validação de caminhos; spawn com args estruturados

**Arquivos alterados:**
- `electron/main.js` — remove `runCliSession`/`createAnswerBook`; passa a usar `StreamGrabCore` via IPC
- `electron/index.html`, `electron/renderer.js`, `electron/styles.css`, `electron/preload.js`

**Riscos:** muito alto — maior superfície. Mitigação: core testado (P2–P7); UI antiga preservada por 1 release (comutável por variável de ambiente).

**Testes / Critérios:**
- IPC: payloads inválidos rejeitados; sem caminhos absolutos arbitrários.
- `contextIsolation: true`, `nodeIntegration: false`, **`sandbox: true`** com preload funcionando (teste dedicado), CSP ativa.
- Renderer não importa módulos internos (`src/cli/*`).
- Fluxo completo E2E com servidor local de mídia.

**Rollback:** UI antiga em `electron/legacy-ui/` até validação.

**Complexidade:** muito alta.

---

### PARTE 10 — Windows Installer + CI/Releases Essencial (seções 7, 30)

**Objetivo:** `StreamGrab-Setup.exe` funcional em máquina Windows limpa (sem Node.js/FFmpeg/yt-dlp manuais) + CI essencial em PRs.

**Arquivos novos:**
- Config electron-builder (ou alternativa) — target **Windows `nsis` primeiro** (Linux/macOS depois)
- `.github/workflows/ci.yml` — PRs: install → lint → unit → integration → build Electron
- `.github/workflows/release.yml` — tags: build → empacotamento → checksums → artifacts → GitHub Release (publicação manual/explícita)
- `scripts/package-resources.mjs` — empacota FFmpeg (vendor/ffmpeg), yt-dlp (binário do youtube-dl-exec), curl-impersonate (se presente) em `extraResources`
- `scripts/update-ytdlp.mjs` — atualização do binário yt-dlp (erros de versão → mensagem clara)

**Arquivos alterados:**
- `package.json` (scripts `dist`, `dist:win`, `release`)
- `src/ffmpeg/service.js`, `src/transports/curl.js`, `src/providers/ytdlp/index.js` — resolução de binários em produção (`process.resourcesPath` vs dev)
- README (seção Building)

**Auto-update (33):** NÃO agora — só depois de releases confiáveis e assinatura definida.

**Riscos:** médio — empacotamento de binários; smoke test manual no artefato em máquina limpa.

**Critérios de aceitação:** instalador gera app funcional com FFmpeg/yt-dlp resolvidos; CI verde em PR; release manual dispara pipeline.

**Rollback:** CI/release são aditivos.

**Complexidade:** média–alta.

---

### PARTE 9 — CLI Evoluída (seção 44)

**Objetivo:** CLI não-interativa compartilhando o core — **evolução aditiva** (awnser.md §10).

**Arquivos novos:**
- `bin/streamgrab.mjs` (ou script `streamgrab`)
- `src/cli/commands.js` — `streamgrab <url>` (interativo atual), `streamgrab analyze <url>`, `streamgrab download <url> [--audio-only] [--format <id>] [--output <dir>] [--turbo] [--cookies ...]`
- `src/cli/render.js` — saída de progresso (reusa `progress.js`)

**Arquivos alterados:**
- `src/index.js` → parseia subcomandos (sem quebrar chamadas atuais)

**Testes / Critérios:**
- `analyze`/`download` sem interação (stdin não usado); exit codes: 0 ok, 1 erro, 130 cancelado.
- Flags antigas continuam funcionando (testes de compatibilidade).

**Rollback:** nova sintaxe é aditiva; nada antigo é removido.

**Complexidade:** média.

---

### PARTE 6.1 — Resume para Downloads Compatíveis (seção 13)

**Objetivo:** downloads resumíveis **somente** em HTTP Range/direct com integridade garantível. **HLS/DASH ficam de fora** (aprovado).

**Arquivos novos:**
- `src/core/resume.js` — `DownloadState { url, destination, totalSize, etag, lastModified, validators, chunks[] }` com escrita atômica; valida ETag/Last-Modified/tamanho; nunca concatena dados se o recurso mudou; URL expirada → reanálise
- `src/core/session.js` — reanálise de URL expirada antes de retomar

**Arquivos alterados:** `src/transports/range.js` (usa `resume.js`)

**Riscos:** alto — URL assinada expirada é a maior armadilha.

**Testes / Critérios:**
- Servidor local: interromper → retomar → hash idêntico ao download limpo.
- Recurso remoto mudou (ETag novo) → parcial descartado, recomeça.
- HLS/DASH: documentar que "resume" = re-exec do FFmpeg (fora de escopo de chunks).

**Rollback:** opt-in por job; flag `--no-resume`.

**Complexidade:** alta.

---

### PARTE 6.2 — Smart Turbo (seção 14)

**Objetivo:** turbo adaptativo **orientado por benchmark** (awnser.md §16) — após produto desktop funcional.

**Pré-requisito obrigatório:** criar baseline e medir throughput (total e por conexão), overhead, tamanhos, latências e throttling. A heurística nasce dos testes, não de suposição. Ex.: 2→4→8→12→8 com backoff, respeitando limites e sem comportamento agressivo contra servidores.

**Arquivos novos:** `src/core/smart-turbo.js`, `tests/performance/` (baseline)

**Arquivos alterados:** `src/transports/range.js`

**Testes / Critérios:**
- Simular throttling no servidor local → concurrency reduz; sem induzir 403/429.
- Decisões documentadas com dados do baseline.

**Rollback:** desligável por config.

**Complexidade:** alta.

---

### PARTE 11 — Docs, Maturidade, Performance, Refinamentos (seções 34, 35, 36, 42, 43, 49)

**Objetivo:** README como produto, CONTRIBUTING, roadmap, UX de falhas, DRM e baseline de performance.

**Arquivos novos:**
- `CONTRIBUTING.md` — setup, arquitetura, como criar um provider, testes, estilo, PRs
- `docs/roadmap.md` — Fases A–E públicas
- `docs/architecture.md` — diagramas e ADRs
- `tests/performance/` — scripts de baseline (análise, download, CPU/memória, mux)

**Arquivos alterados:**
- `README.md` — reescrita completa (sem números hardcoded de sites; limitações de DRM explícitas)
- `src/core/errors.js` + UI — mensagens "Motivo / Ação sugerida / [Detalhes]" (seção 42)
- `src/providers/*/drm.js` — reforço da detecção Widevine/PlayReady/FairPlay → erro explícito

**Critérios de aceitação:** docs refletem o código; DRM sempre erro claro; baseline registrado em `docs/performance.md`.

**Complexidade:** baixa–média.

---

## 16. Mapeamento para as Fases do Roadmap (seção 36 do architect.md)

| Fase | Partes | Entregável |
|---|---|---|
| **A — Fundação** | P0, P1, P2.1–P2.6, P3, P4, P5 | Testes, branding, core, providers, transports, FFmpeg central |
| **B — Produto Desktop** | P7, P8, P10 | Fila/settings/histórico, nova UI, installer Windows |
| **C — Download Management** | P9, P6.1 | CLI evoluída, resume |
| **D — Performance** | P6.2 | Smart Turbo orientado por benchmark |
| **E — Maturidade** | P11 | Docs, segurança, DRM, baseline, refinamentos |

---

## 17. Riscos Gerais

| Risco | Severidade | Mitigação |
|---|---|---|
| Refactor do core quebra HLS real (mdstrm/curl) | **Crítico** | P0 antes de tocar; P3 preserva mecanismo de download atual; curl-flow vira transporte sem mudar semântica |
| Fallback automático mascara auth/DRM | **Alto** | Classificação de erros (P2.2); 401/403/DRM terminais por classe; nunca loop de transports |
| Resume com URL assinada expirada | **Alto** | Reanálise obrigatória; ETag/Last-Modified; nunca concatenar parcial se recurso mudou (P6.1) |
| `sandbox: true` quebra preload/IPC | **Alto** | Teste de segurança dedicado; migração gradual com feature flag (P8) |
| Secrets vazam em logs | **Alto** | Redação central (P2.2) + testes específicos de redaction |
| Empacotamento de binários (Windows) | **Médio** | `extraResources` versionado; smoke test em máquina limpa (P10) |
| Persistência corrompida (crash) | **Médio** | Escrita atômica + versionamento de schema (P7) |
| Escopo inflar (features antes da base) | **Médio** | Ordem aprovada + gate de aceitação por parte + STOP obrigatório |

---

## 18. Anti-Overengineering (awnser.md §8)

Provider, Transport, DownloadEngine e FFmpegService são criados porque **representam responsabilidades reais já existentes** no código (adapters, fluxos de download, ffmpeg.js). Regras:

- Nenhuma classe/interface/factory/manager só porque "aparece no plano".
- Preferir composição e módulos simples.
- Antes de criar abstração: o problema concreto existe hoje no código? Se não, não crie.
- **Sem TypeScript nesta migração** (awnser.md §9).

---

## 19. Decisões Resolvidas e Pendentes

**Resolvidas (aprovadas):** todas as 9 da seção 1.1 + as regras da seção 1.2 + P2 subdividida + nova ordem (seção 2).

**Ainda pendentes (decisões reais, serão resolvidas no início da parte correspondente):**

1. **P8 — UI Electron:** estilo vanilla JS + templates vs framework leve. Recomendação: vanilla + templates nesta fase (sem bundler pesado).
2. **P10 — Ferramenta de empacotamento:** electron-builder (recomendado) vs alternativa. Confirmar junto com nome/identidade do instalador (`StreamGrab-Setup.exe`).
3. **P3 — Escopo do Provider mdstrm:** manter como estratégia de URL do provider HLS (recomendado) vs provider separado.
4. **P2.6 — Formato de eventos para o terminal:** manter o formato atual da barra de progresso (recomendado) vs novo formato.

---

## 20. Estimativa de Complexidade por Parte (sem tempos exatos)

| Parte | Complexidade |
|---|---|
| P0 | Baixa–média |
| P1 | Baixa |
| P2.1 | Média |
| P2.2 | Média |
| P2.3 | Baixa–média |
| P2.4 | Média |
| P2.5 | Média–alta |
| P2.6 | Média–alta |
| P3 | Média–alta |
| P4 | Alta |
| P5 | Média |
| P7 | Média–alta |
| P8 | Muito alta |
| P10 | Média–alta |
| P9 | Média |
| P6.1 | Alta |
| P6.2 | Alta |
| P11 | Baixa–média |

---

## 21. Critérios de Aceitação Gerais

- A CLI atual não quebra durante toda a migração (flags, exit codes, saída).
- Os E2E existentes (incl. `test-curl-e2e.mjs`) passam a cada Parte.
- Nenhum secret em logs persistidos (testes de redaction verdes).
- Fallback nunca contorna auth/DRM.
- Cada Parte termina com: testes executados, resultados, regressões, rollback avaliado e relatório de 12 itens.

---

## 22. Estratégia de Migração — Strangler em 6 Passos (awnser.md §7)

Sempre que uma implementação antiga for substituída:

1. Criar/testar o substituto.
2. Manter compatibilidade (fachada/re-export).
3. Migrar consumidores um a um.
4. Executar regression tests.
5. Confirmar que nenhuma referência permanece.
6. **Somente então propor a remoção** do código antigo.

Regras adicionais: não mover código para `legacy/` apenas por "limpeza"; não manter duas implementações permanentes fazendo a mesma coisa (a remoção é proposta e aprovada pelo usuário).

---

## 23. Prioridades da Migração (awnser.md §17)

1. Correção
2. Segurança
3. Testes
4. Arquitetura
5. Confiabilidade
6. UX
7. Distribuição
8. Performance
9. Novas features

Não sacrificar estabilidade para implementar rapidamente todas as features da spec.

---

## 24. Regras de Execução (obrigatórias)

1. **STOP após cada Parte** — o usuário aprova uma Parte → implementar somente ela → executar todos os testes relevantes → apresentar relatório → **PARAR** e aguardar aprovação explícita para a próxima. Não executar P0→P11 automaticamente.
2. **Relatório obrigatório ao finalizar cada Parte** (12 itens):
   1. Resumo do que foi implementado.
   2. Arquivos criados.
   3. Arquivos modificados.
   4. Arquivos removidos, se houver.
   5. Dependências adicionadas/removidas.
   6. Testes executados.
   7. Resultado de cada conjunto de testes.
   8. Regressões encontradas.
   9. Problemas ou limitações conhecidas.
   10. Desvios em relação ao plano original e justificativa.
   11. Dívida técnica introduzida, se houver.
   12. O que a próxima Parte pretende alterar.
   - Encerrar com: `PARTE CONCLUÍDA — AGUARDANDO APROVAÇÃO PARA CONTINUAR.`
3. **P0 antes de qualquer refactor** — testes de caracterização primeiro.
4. **Testes antes das mudanças** — criar/ajustar testes primeiro quando necessário; rodar após cada etapa.
5. **Mudanças pequenas** — commits logicamente separáveis; não misturar refactor gigante com feature gigante.
6. **Strangler em 6 passos** (seção 22) — nunca remover código antigo antes do substituto validado.
7. **Sem abstrações prematuras** (seção 18); sem TypeScript nesta migração.
8. **CLI compatível** — evolução aditiva; flags existentes preservadas até substituto + testes de compatibilidade.
9. **Redação de secrets** — URLs assinadas, cookies, Authorization, Referer sensível e stderr de processos externos nunca em logs persistidos; testes específicos.
10. **Fallback ≠ bypass** — classificar erros; nunca loop de transports para 401/403/DRM.
11. **Sem cobertura artificial** — testar comportamento e fronteiras importantes.
12. **Segurança de processos** — spawn sempre com args estruturados; nunca montar comandos como string de shell com entrada do usuário.
13. **Não alterar escopo silenciosamente**; não adicionar dependências sem justificar; reportar regressões imediatamente; não esconder testes quebrados.
14. **Registrar decisões (ADRs)** e atualizar docs conforme o comportamento muda.
15. **Nunca implementar bypass de DRM.**

---

**PLANO REVISADO — AGUARDANDO APROVAÇÃO PARA INICIAR P0.**

Nenhum arquivo de código foi modificado. Ao aprovar, começo pela **P0 (Regression/Characterization Tests)** e, ao concluí-la, apresento o relatório de 12 itens e paro.
