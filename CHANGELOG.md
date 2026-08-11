# Changelog

Todas as mudanças notáveis do StreamGrab serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota
[Semantic Versioning](https://semver.org/lang/pt-BR/) com série **0.x** durante a migração
arquitetônica (`0.1.x` — base; `1.0.0` — versão considerada estável).

## [Não publicado]

### Adicionado
- **ProviderRegistry + Providers normalizados (P3):** `src/providers/*` — contrato de
  Provider (`{ id, label, priority, detect, analyze, getFormats, prepareDownload }`),
  registro por prioridade (`ProviderRegistry.detect/detectAsync/get/list`) com probe de
  Content-Type para URLs desconhecidas e providers embutidos: `ytdlp` (migrado de
  `src/adapters/ytdlp.js`, normaliza o JSON do yt-dlp em `MediaInfo`/`Format` sem vazar o
  shape cru), `hls` (envolve `src/hls.js` + estratégia de URL mdstrm), `dash` (envolve
  `src/dash.js`) e `direct`. Detecção de DRM clara e sem contorno: HLS rejeita
  `#EXT-X-SESSION-KEY`/`#EXT-X-KEY` com METHOD fora de NONE/AES-128 e DASH rejeita
  `<ContentProtection>` (Widevine/PlayReady/FairPlay/cenc) via `UnsupportedDrmError`.
  `src/source-adapters.js` mantida como **fachada de compatibilidade** (API e rótulos
  legados intactos — CLI, engine, Electron e testes inalterados); `fetchPlaylistText`/
  `fetchDashManifestText` novos em `src/hls.js`/`src/dash.js`; `YOUTUBE_ADAPTER`/
  `SOCIAL_ADAPTER` viraram seletores do provider ytdlp; `src/core/index.js` agora também
  exporta `ProviderRegistry`/`createDefaultProviderRegistry`. Mecanismos de download
  (FFmpeg/curl-flow/turbo/mux) inalterados. 34 testes unitários novos
  (`tests/unit/providers-*.test.js`).
- **CLI no novo Core (P2.6):** `src/cli-flow.js` passa a consumir `StreamGrabCore`
  (strangler) na análise de fontes baseadas em adapter (YouTube/redes sociais) via
  `core.analyze(url, { headers, auth, forceYouTube })`, com MediaInfo normalizado
  preservando título, variants e formatos; HLS/DASH/direto mantêm os fluxos tolerantes a
  falha atuais e os downloads (turbo/mux/curl) seguem dedicados até os transports serem
  migrados. Comportamento observável idêntico: flags, prompts, exit codes e MODE_LABELS
  inalterados. 3 testes de caracterização novos (`tests/unit/cli-flow-core.test.js`) com
  yt-dlp e ffmpeg mockados provando que o ciclo CLI → Core → download termina com exit 0.
- **DownloadEngine (P2.5):** `src/core/engine.js` — motor de ciclo de vida do job
  (`queued → analyzing → preparing → downloading → paused/merging → completed/failed/cancelled`)
  emitindo os eventos da P2.3, **independente de CLI/Electron** (sem console/readline/IPC).
  `DownloadEngine` recebe um job (URL nova ou id existente) via `run()` e orquestra:
  resolução de adapter (`defaultResolveAdapter`, injetável e sem rede nos testes),
  executor injetável (`createDefaultExecutor` — analyze/prepare/run com roteamento
  mux/HLS/DASH/direto), cancelamento interrompe (queued/paused/ativos, com limpeza de
  parciais), pause/resume com AbortController, erro classificado na taxonomia da P2.2 e
  estado consistente serializável via `models.js`. `src/core/registry.js` virou fachada
  fina que delega toda a execução ao engine (API pública idêntica: `analyze`/`enqueue`/
  `download`/`pause`/`resume`/`cancel`/`getQueue`/`getHistory`), `createDefaultExecutor`
  re-exportado. `src/core/index.js` agora também exporta `DownloadEngine`,
  `createDownloadEngine` e `defaultResolveAdapter`. 17 testes unitários novos com executor
  e resolver mockados (sem rede).
- **StreamGrabCore (P2.4):** `src/core/registry.js` — fachada pública `StreamGrabCore`
  (`analyze`/`enqueue`/`download`/`pause`/`resume`/`cancel`/`getQueue`/`getHistory`)
  consumível por CLI, Electron e harness de teste com a mesma API, delegando aos adapters
  existentes via executor injetável (`createDefaultExecutor`: analyze/prepare/run com
  roteamento mux/HLS/DASH/direto sobre os mesmos `ffmpeg.js` e adapters usados hoje).
  Ciclo de vida dos jobs via `models.js` (transições válidas), eventos da P2.3 com payload
  padronizado (`start/progress/speed/eta/pause/resume/complete/error/cancel`), throttling de
  progresso, cancelamento de jobs queued/paused/ativos, pause/resume com AbortController e
  limpeza de arquivos parciais. `src/core/index.js` — API única do núcleo
  (`StreamGrabCore`, `createStreamGrabCore`, `createDefaultExecutor` + re-exports de
  models/errors/logger/filenames/events). 18 testes unitários + 2 de integração (harness real
  com servidor local e executor real, sem mocks).
- **Event System (P2.3):** `src/core/events.js` — event bus de progresso sem dependência de UI
  (seção 6 do architect.md). Eventos `start/progress/speed/eta/pause/resume/complete/error/cancel`
  (com aliases conceituais `download:*`), payload padronizado (`bytesDownloaded`, `totalBytes`,
  `percent`, `speed`, `etaSeconds`, `stage`, `chunks`, `muxStatus`, `message`), assinatura
  `on/once/off` com unsubscribe, `emit` com try/catch por handler (erro em handler nunca derruba
  o emissor, com hook opcional `onHandlerError`), e `EVENT_NAMES`/`JOB_STAGES` congelados.
  14 testes unitários novos.
- **Errors, Logger e Filenames (P2.2):** `src/core/errors.js` (taxonomia da seção 26 do
  architect.md: 14 classes + `classifyError()` por status HTTP/códigos Node/códigos de adapters,
  com mensagem amigável, detalhe técnico e retryability), `src/core/logger.js` (níveis
  debug/info/warn/error com redação automática de URLs assinadas, headers Authorization/Cookie
  e stderr de processos externos), `src/core/filenames.js` (política central: sanitização
  Windows, nomes reservados, Unicode, limite de 255 bytes, colisões `Video (1).mp4` e bloqueio
  de path traversal). 40 testes unitários novos.
- **Domain Models (P2.1):** `src/core/models.js` — modelos normalizados `MediaInfo`, `Format`,
  `DownloadJob` e estados do job (`queued/analyzing/preparing/downloading/paused/merging/completed/failed/cancelled`)
  com validação de shape, matriz de transições e serialização limpa (sem campos circulares).
  Nenhum consumidor ainda (rollback trivial). 25 testes unitários novos.
- Suíte de testes de regressão/caracterização (P0): 112 testes unitários, 21 de integração
  e suíte E2E (HLS AES-128, fMP4, MP4 direto, DASH, detecção curl-impersonate) — `npm test`.
- Configuração de qualidade: ESLint (flat config), Prettier e EditorConfig.
- Scripts npm: `test`, `test:unit`, `test:integration`, `test:e2e`, `lint`, `format`.

### Alterado
- **Detecção de fonte delegada ao ProviderRegistry (P3):** `src/source-adapters.js` virou
  fachada fina sobre `src/providers/registry.js` — resolução por prioridade (yt-dlp > HLS >
  DASH > direto) + probe de Content-Type mantido; URLs de domínios mdstrm passam a ser
  classificadas como HLS. `src/adapters/youtube.js` e `src/adapters/social.js` delegam ao
  provider ytdlp (exports e contrato preservados).
- **Branding:** identidade migrada para **StreamGrab** em títulos de janela (Electron),
  UI (CLI/Electron), README (PT/EN/ES), `config.example.json` e keywords do `package.json`.
- **Versionamento:** série SemVer voltou para `0.x` (de `1.0.0` para `0.1.0`) durante a migração.
- Estrutura de testes reorganizada: `test-curl-e2e.mjs` → `tests/e2e/curl-e2e.mjs`,
  `smoke-speed.mjs` → `tests/e2e/smoke-speed.mjs`, `smoke-uvweb.mjs` → `tests/e2e/smoke-uvweb.mjs`.

### Corrigido
- Script `test` do `package.json` apontava para arquivo movido (quebrado) — atualizado.
- Caso E2E "arquivo direto MP4": saída truncada (261 bytes) por `moov` no fim do arquivo
  sem suporte a Range no servidor local — geração do fixture agora usa `-movflags +faststart`.
- Caso E2E "DASH": temp files do demuxer (`init-*.mp4`, `seg-*.m4s`) poluíam a raiz do
  repositório — o processo CLI roda com `cwd` no diretório temporário do teste.
