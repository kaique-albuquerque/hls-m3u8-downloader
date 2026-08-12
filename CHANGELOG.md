# Changelog

Todas as mudanças notáveis do StreamGrab serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota
[Semantic Versioning](https://semver.org/lang/pt-BR/) com série **0.x** durante a migração
arquitetônica (`0.1.x` — base; `1.0.0` — versão considerada estável).

## [Não publicado]

### Adicionado
- **CLI evoluída (P9):** subcomandos não-interativos `streamgrab analyze <url>` e
  `streamgrab download <url>` (seção 44 do architect.md), aditivos — o fluxo
  interativo atual (`streamgrab <url>` / `node src/index.js`) continua idêntico.
  - `bin/streamgrab.mjs` — entry point `streamgrab` (package.json `"bin"` + scripts
    `streamgrab`/`analyze`/`download`).
  - `src/cli/commands.js` — dispatch e implementação dos subcomandos: `parseCliCommand`,
    `parseAnalyzeFlags`, `parseDownloadFlags`, `runAnalyzeCommand`, `runDownloadCommand`,
    `resolveQualityChoice` (`--format <n|id>`), `createNonInteractiveAnswers`,
    `runAudioOnlyFlow` (`--audio-only` com extração por FFmpeg).
  - `src/cli/render.js` — saída de análise legível ou `--json` (`analysisToJson`,
    `renderAnalysis`, `printAnalysisError`, `formatDuration`).
  - `src/index.js` — parseia subcomandos sem quebrar chamadas atuais; `help` mostra a
    ajuda dos subcomandos (o `--help` do fluxo interativo preserva o `printUsage`).
  - Flags do download: `--audio-only`, `--format <n|id>`, `--output <dir>`,
    `--filename <nome>`, `--turbo`, `--chunks <n>`, `--cookies <f>`,
    `--cookies-from-browser <b>`, `--curl-impersonate`, `--referer`, `--user-agent`.
  - Exit codes: 0 ok, 1 erro, 130 cancelado (Ctrl+C em `src/input.js`).
  - `src/ffmpeg/muxer.js` + `src/cli/download.js`: novo parâmetro aditivo `outputArgs`
    (opções de saída após o `-i`, ex.: `-vn` no `--audio-only`), sem quebrar `extraArgs`.
  - 20 testes novos: `tests/unit/cli-commands.test.js` (19) + `ffmpeg-muxer.test.js`
    (1 para `outputArgs`). Validado de ponta a ponta com servidor HLS local real
    (analyze texto/JSON, download e `--audio-only`).
- **Instalador Windows + CI/Releases essencial (P10):** `StreamGrab-Setup-<versão>.exe`
  (NSIS) funcional em máquina Windows limpa (sem Node.js/FFmpeg/yt-dlp manuais) e CI
  essencial em PRs (seções 7 e 30 do architect.md).
  - `electron-builder.yml` — configuração do electron-builder: alvo Windows `nsis` (x64)
    primeiro, `electronDist: node_modules/electron/dist` (reusa o Electron local, sem
    re-download), `asar: true`, `extraResources` de `build/extraResources` para
    `resources/` (FFmpeg, yt-dlp e curl-impersonate opcional em `bin/`).
  - `src/core/binaries.js` — módulo puro (sem Electron) que resolve binários: em dev
    usa as pastas do projeto; em produção lê `STREAMGRAB_RESOURCES_PATH` (definida por
    `electron/main.js` quando `app.isPackaged`) e resolve em `<resourcesPath>/bin/`;
    `getYtDlpExec()` usa `import()` dinâmico (compatível com `mock.module` nos testes)
    e prefere `create(binárioEmpacotado)` quando disponível.
  - `scripts/package-resources.mjs` — empacota FFmpeg (`vendor/ffmpeg/`), yt-dlp
    (`youtube-dl-exec/bin/`) e perfis curl-impersonate (`tools/curl_*.bat`, opcional) em
    `build/extraResources/bin`; falha com mensagem clara se um obrigatório estiver
    ausente.
  - `scripts/update-ytdlp.mjs` — atualiza o binário do yt-dlp a partir do GitHub
    (latest release), valida a versão com `--version` e copia para todas as cópias
    locais; erros de rede/versão viram mensagem clara + exit 1.
  - `scripts/checksums.mjs` — gera `dist/SHA256SUMS.txt` (SHA-256 dos artefatos
    `.exe|.blockmap|.yml`).
  - `.github/workflows/ci.yml` — PRs/pushes para `main`: npm ci → lint → testes
    (unit + integração + E2E) → `npm run dist:dir` (valida empacotamento).
  - `.github/workflows/release.yml` — publicação manual/explícita: push de tag `v*`
    roda testes, `npm run dist`, checksums e publica a GitHub Release com os artefatos.
  - Scripts npm: `pack:resources`, `update:ytdlp`, `dist`, `dist:dir`, `dist:linux`,
    `release`.
  - Seção de empacotamento no README (PT-BR e EN). 16 testes unitários novos
    (`tests/unit/binaries.test.js`, `package-resources.test.js`, `update-ytdlp.test.js`).
  nodeIntegration, sandbox, preload mínimo, validação de IPC, shell/processos restritos,
  path traversal, URLs não confiáveis, CSP).
  - `electron/security.js` — módulo puro (sem Electron) que valida **todas** as mensagens
    IPC do renderer: `isSafeHttpUrl` (somente http/https), `isValidTaskId`
    (`/^[A-Za-z0-9_-]{1,64}$/`), `sanitizeDownloadFilename` (rejeita separadores e
    traversal `..`; limpa caracteres inválidos do Windows), `isAbsolutePath`/`isSafeAbsolutePath`
    (sem segmentos `..`), `validateAnalyzePayload`/`validateDownloadPayload`/
    `validateCancelPayload` (payload limpo ou `null`) e `validateRevealPayload(payload,
    allowedRoots)` — abertura de arquivo/pasta só dentro de raízes registradas
    (diretório escolhido, Downloads padrão e raiz do projeto).
  - `electron/media-info.js` — normalização do resultado dos providers em `MediaInfo`/
    `Format` para a UI (seção 9): `formatDuration`, `estimateSizeBytes`,
    `normalizeVariantToFormat` (HLS master/yt-dlp), `normalizeRepresentationToFormat`
    (DASH) e `normalizeMediaInfo` (título, duração, thumbnail, provider, protocolo,
    resolução, codecs, container, bitrate e tamanho estimado por formato).
  - `electron/preload.cjs` — ponte mínima compatível com `sandbox: true` (CommonJS, sem
    acesso ao Node no renderer): expõe apenas `analyzePlaylist`, `startDownload`,
    `cancelDownload`, `pickOutputDir`, `resolvePaths`, `openFile`, `showInFolder` e
    listeners de log/status/progresso/estado/conclusão.
  - `electron/index.html` — CSP restritiva (`default-src 'none'`; script/style/imagens/
    connect somente ao necessário; `form-action 'none'`; `frame-ancestors 'none'`), seção
    de metadata (título, duração, provider/protocolo, codec/resolução, bitrate, tamanho
    estimado, thumbnail), botões "Abrir arquivo"/"Mostrar na pasta" após conclusão e
    botão "Adicionar à fila".
  - IPC novos em `electron/main.js`: `app:open-file` e `app:show-in-folder` (via
    `shell.openPath`/`shell.showItemInFolder`, restritos a raízes registradas).
  - 30 testes unitários novos (`tests/unit/electron-security.test.js` e
    `tests/unit/electron-media-info.test.js`).

- **Queue, Settings, Histórico e Persistência (P7):** camada de estado persistente
  (seções 10/12/21/22/46/37/38 do architect.md) com 6 módulos novos em `src/core/` e
  re-exports na API pública (`src/core/index.js`).
  - `src/core/storage.js` — persistência JSON com escrita atômica (`file.tmp` + `renameSync`;
    crash no meio nunca corrompe o arquivo anterior), `readJsonSafe` tolerante a
    corrompido/ausente e `createJsonStore` versionado (`{ version: 1 }`): merge tolerante
    (campos conhecidos prevalecem do arquivo), downgrade seguro (campos de versão futura
    ignorados; campos de versão anterior preservados) e `get/save/set/load/exists`.
  - `src/core/settings.js` — preferências persistidas (seção 22): `DEFAULT_SETTINGS` com
    `defaultDir`, `maxConcurrentDownloads [1,16]`, `turbo`, `turboChunks [1,32]`,
    `defaultQuality`, `audio`, `notifications`, `theme`, `onComplete` e
    `historyRetentionDays [0,3650]`; `normalizeSettings` ignora chaves desconhecidas e
    coage/clampa tipos; `createSettingsStore` com `all/get/set/update/reset` (storage
    injetável para testes).
  - `src/core/history.js` — histórico local (seção 21): entradas com `id/title/url/provider/
    format/destination/date/status/size/durationMs`, `createHistoryStore` com `add/list/get/
    remove/clear/count`, `maxEntries` e `retentionDays` (prune no load; 0 = manter para
    sempre). Privacidade: 100% local e controlável pelo usuário (remover/limpar).
  - `src/core/queue.js` — fila de downloads (seção 10) sobre o `DownloadEngine`: limite de
    simultâneos (`maxConcurrent`, clamp 1–16), auto-start até o limite, `pause/resume/cancel`
    (job e fila), `retry` (re-enfileira a mesma URL com `meta.retryOf`), `remove`, `reorder`
    (lança `QUEUE_BUSY` com downloads ativos, `INVALID_INDEX` com índices inválidos),
    `getOutputPath` (abrir arquivo/pasta é responsabilidade da UI) e persistência com crash
    recovery (`snapshot/restore/save/load` — jobs em andamento são revalidados como `queued`).
  - `src/core/disk.js` — `getFreeBytes` via `fs.statfs` (null sem lançar), `checkDiskSpace`
    com `DiskSpaceError` amigável (código `DISK_SPACE_ERROR`) incluindo temporário extra p/ mux
    (`estimateMuxSpace` 2.2x + 50MB de margem).
  - `src/core/atomic.js` — download atômico `.part` → rename com validação: `createAtomicFile`
    (`write/commit/abort`, `EMPTY_PARTIAL` rejeita arquivo vazio), `moveIntoPlace` e
    `cleanupPart`.
  - 64 testes novos (`tests/unit/core-storage|settings|history|queue|disk-atomic|engine-p7`)
    cobrindo: escrita atômica e crash simulado, downgrade seguro, clamps/coerção de settings,
    retenção de histórico, limite de simultâneos, cancelar/retry/remover/reordenar,
    crash recovery da fila e integração engine+settings+disk+history+atomic.
- **FFmpegService e Áudio (P5):** `src/ffmpeg/` — serviço central de FFmpeg (seções 20/11 do
  architect.md) com detecção de binário (vendor/ffmpeg ou PATH), execução por spawn com args
  (nunca string montada), progresso por eventos (`-progress pipe:1` →
  `onProgress({ key, value })`), cancelamento (stop() gracioso com 'q' + SIGKILL após 6s como
  último recurso, suporte a AbortSignal incl. pré-abortado) e cleanup de listeners.
  - `src/ffmpeg/service.js` — `getFfmpegCommand`, `checkFfmpeg` (nunca lança), classe
    `FfmpegService` com `run({ args, onProgress, signal })` → `{ promise, stop, child }`,
    stderr limitado a 60000 chars e singleton `ffmpegService`.
  - `src/ffmpeg/muxer.js` — `MODES`/`MODE_LABELS` (copy / copy-adtstoasc / aac), construtores
    puros de args (`buildDownloadArgs`, `buildMuxArgs`, `formatHeaders`), `startDownload`/
    `startMuxDownload` com contrato legado `{ promise, stop, mode }` e aliases `remux`/`mux`.
  - `src/ffmpeg/audio.js` — `AUDIO_PROFILES` (original/m4a/mp3/opus/flac), `canRemuxToProfile`
    (regra "só remux vs exige transcode" conforme codec de origem) e `audioProfileToArgs`
    (ex.: mp3 a partir de aac → `-vn -c:a libmp3lame`; original → `-vn -c:a copy`).
  - 37 testes novos: 31 unitários (`tests/unit/ffmpeg-audio|muxer|service.test.js`, spawn
    fake injetado, sem binário) e 6 de integração com FFmpeg real
    (`tests/integration/ffmpeg-service.test.js`), gated por `checkFfmpeg()`.
- **Transports básicos + Strategy Selection (P4):** camada de transporte desacoplada da CLI
  (seções 15/16/39/40/41 do architect.md) com seleção de estratégia por tipo de erro e
  rollback via `STREAMGRAB_LEGACY_FLOW=1`.
  - `src/transports/http.js` — `downloadUrl` com fetch nativo (stream → arquivo), limites de
    velocidade/bytes, timeout e cancelamento via `AbortSignal`; `isNotMediaResponse`/sniff de
    HTML no lugar de mídia (`NOT_MEDIA`), `isAuthError` (`AUTHENTICATION_ERROR`/`FORBIDDEN_ERROR`),
    `extForUri` e `probeUrl` com redirecionamento seguido.
  - `src/transports/range.js` — `probeRangeSupport` (valida `Accept-Ranges`/`Content-Range`;
    servidor sem Range → `RANGE_UNSUPPORTED`) e `downloadParallelRanges` com chunking paralelo,
    concorrência limitada (Semaphore do core), retomada de chunk parcial e validação de
    `INVALID_CONTENT_RANGE`; erros de rede/429/5xx retryáveis, 403/HTML terminais.
  - `src/transports/curl.js` — `CurlImpersonateTransport` (client injetável + fallback de
    fluxo legado via `rewritePlaylist`/`extForUri` re-exportadas) com `resolve`/`client`/
    `getText`/`downloadSegments` para HLS via curl-impersonate.
  - `src/transports/ytdlp-runner.js` — `runYtDlpDownload` para rodar yt-dlp somente quando é a
    opção correta da fonte: format/output/noPlaylist/cookies/user-agent, progresso por callback
    e cancelamento real via `Promise.race` + `SIGKILL` do child (`CancelledError`).
  - `src/core/strategy.js` — `TERMINAL_CODES` (403/401/DRM/URL expirada/mídia ausente/HTML/
    cancelamento/disco/permissão/formato → **nunca** loop de transports), `selectStrategy`,
    `resolveFallback`/`canFallback` (fallback ≠ bypass) e `isTerminalError`.
  - `src/core/retry.js` — `retryWithBackoff` com backoff exponencial + jitter 50-100%,
    teto `maxDelayMs`, `Retry-After` (segundos e data HTTP), `parseRetryAfter` e `sleep`
    cancelável via signal.
  - `src/core/resources.js` — `ResourceManager`/`Semaphore`/`createDefaultResourceManager`
    (limite de conexões paralelas com cancelamento seguro por signal e liberação correta de
    listeners de abort).
  - 80 testes unitários novos (`tests/unit/core-retry|strategy|resources` e
    `tests/unit/transports-http|range|curl|ytdlp-runner`) com servidores HTTP locais
    (com/sem Range, 403, 429, HTML no lugar de mídia) e `mock.module` para yt-dlp.
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
- **Resolução de binários unificada (P10):** `src/ffmpeg/service.js` (ordem: empacotado
  > `vendor/ffmpeg` > PATH), `src/curlimp.js` (inclui `<resourcesPath>/bin` na busca),
  `src/adapters/ytdlp.js` e `src/transports/ytdlp-runner.js` (yt-dlp via
  `getYtDlpExec()`) agora consomem `src/core/binaries.js`; `electron/main.js` define
  `STREAMGRAB_RESOURCES_PATH` quando empacotado. `package.json` ganhou o script `dist*`/
  `release` e a devDependency `electron-builder`.
- **Electron com IPC validado e sandbox (P8):** `electron/main.js` valida toda mensagem
  IPC recebida do renderer via `electron/security.js` (analyze/download/cancel/reveal);
  `createWindow` passa a usar `sandbox: true` com `contextIsolation: true`,
  `nodeIntegration: false` e preload CommonJS (`preload.cjs` — o antigo `preload.js`
  ESM foi removido porque sandbox não suporta ESM no preload); `playlist:analyze` e
  `download:start` retornam resposta normalizada por `media-info.js` (`media` com
  `formats`/`best`/tamanho estimado). `electron/renderer.js` ganha `renderMediaInfo`,
  `startDownloadInTab` (fluxo de download extraído do handler do botão), fila via novas
  abas (`addTab({ copyFrom })` + botão "Adicionar à fila" — a UI nunca bloqueia durante
  análise/download) e exibição dos botões de abrir/localizar ao concluir;
  `electron/styles.css` adiciona estilos de metadata/thumbnail/reveal (responsivos).
- **P7 — integração do estado persistente:** `src/core/engine.js` aceita colaboradores
  opcionais `settings/disk/history/atomic` (regressão zero: sem eles o comportamento é o
  mesmo da P5) — `defaultDir` dos settings vira fallback de destino, checagem de disco antes
  de baixar (incl. temporário extra para mux), histórico registrado em completed/cancelled/
  failed (nunca derruba o download), download direto via `.part` atômico quando `atomic`
  presente, `enqueue` aceita `id` explícito (restauração de fila) e novo `remove(id)`
  (somente jobs terminais; ativo lança `JOB_ACTIVE`). `src/core/registry.js` propaga as novas
  opções e delega `remove`. `src/cli/config.js` ganha `mergeConfigWithSettings` (funde o
  `config.json` legado com os settings persistidos — settings P7 vencem; gera
  `streamgrab.settings.json`). `src/core/index.js` re-exporta storage/settings/history/queue/
  disk/atomic.
- **FFmpeg delegado ao muxer (P5):** `src/ffmpeg.js` virou re-export fino de
  `src/ffmpeg/{service,muxer,audio}.js` (contrato legado preservado — `checkFfmpeg`,
  `getFfmpegCommand`, `startDownload`, `startMuxDownload`, `MODES`/`MODE_LABELS`); a constante
  `INSTALLED_VERSION` (não usada em lugar nenhum) foi removida. `src/cli/download.js` e
  `src/cli/turbo.js` consomem `startDownload`/`mux` do muxer; `src/cli/context.js` re-exporta
  `MODE_LABELS` do muxer; `src/cli/curl-flow.js` não foi alterado diretamente (continua
  delegando a `runDownloadFlow`, que já usa o muxer); `src/core/engine.js` segue intacto,
  consumindo a fachada. Mock de `tests/unit/cli-flow-core.test.js` atualizado para a nova
  divisão fachada/muxer.
- **CLI delegando aos transports (P4):** `src/cli/turbo.js` e `src/cli/curl-flow.js` agora
  consomem `transports/range.js`/`transports/curl.js` (API pública e contrato de erro
  preservados: `no-range`/`interrupted`/`other`, `curl-ausente`/`playlist`/`cancelado`/`sem
  segmentos`/`chave`/`init`/`segmentos`; flags `turboAbort`/`curlimpActive` intactas), e
  `src/cli/context.js` expõe `currentHttpAbort` para interromper downloads HTTP ativos no
  Ctrl+C. `src/core/index.js` re-exporta `STRATEGIES`/`selectStrategy`/`resolveFallback`/
  `canFallback`/`isTerminalError`, `retryWithBackoff`/`computeBackoffDelay`/`parseRetryAfter`/
  `retryAfterFromError`/`sleep` e `ResourceManager`/`Semaphore`/`createDefaultResourceManager`.
  `src/cli/download.js` permanece intacto (FFmpeg é domínio da P5). Rollback da P4 em
  `src/cli-flow.js`: com `STREAMGRAB_LEGACY_FLOW=1` a CLI desativa turbo e curl-impersonate
  (transports novos) e usa somente os fluxos legados de `cli/download.js`.
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
- **m3u8 da Media Stream (mdstrm) retornava 403:** URLs cruas do CDN
  (`*.cdn.mdstrm.com/.../index-v1-a1.m3u8`) copiadas do DevTools falham com 403 para
  qualquer cliente, pois os tokens (pid/sid/uid/access_token) ficam presos à sessão do
  player e expiram. O fluxo principal (`src/cli-flow.js`) e o IPC de análise do app
  (`electron/main.js`, `playlist:analyze`) agora convertem automaticamente a URL crua
  para a URL do player (`https://mdstrm.com/video/<id>.m3u8?...`) buscando as variáveis
  no embed público (`refreshMdstrmUrl` em `src/mdstrm.js`) — funciona SEM
  curl-impersonate (fetch nativo); com curl instalado, usa o cliente para imitar o TLS.
  No `main.js` a conversão antes dependia do curl (`&& found`) — por isso o app
  instalado continuava com 403. O `curl-flow.js` foi refatorado para usar o mesmo
  helper. 4 testes unitários novos. Validado ao vivo: embed → URL do player → 200 OK.
- **Binários não resolvidos em produção (P10, seção 7):** em máquina limpa (sem
  Node/FFmpeg/yt-dlp manuais) o app empacotado não achava FFmpeg/yt-dlp/curl-impersonate
  — agora os binários são empacotados em `extraResources` (`resources/bin/`) e resolvidos
  via `process.resourcesPath`.
- **Download falhava no instalador (P10):** o FFmpeg do `vendor/ffmpeg` (build
  compartilhado do gyan.dev) depende das DLLs na mesma pasta (avcodec-63.dll,
  avformat-63.dll etc.) — o empacotador copiava só o `ffmpeg.exe`, e o app instalado
  falhava com `STATUS_DLL_NOT_FOUND` (0xC0000135) ao iniciar o download.
  `scripts/package-resources.mjs` agora copia também as DLLs de `vendor/ffmpeg`
  (campo `depsDir` + filtro `*.dll`). Validado com a suíte completa rodando com
  `STREAMGRAB_RESOURCES_PATH` apontando para `dist/win-unpacked/resources`
  (513 testes, E2E incluído).
- **Segurança do Electron (P8, seção 24):** renderer tinha `sandbox: false` e recebia
  mensagens IPC sem validação — agora sandbox ativado, todas as mensagens validadas
  (URLs http/https, task ids restritos, nomes de arquivo sem traversal, outputs dentro de
  raízes permitidas); abertura de arquivos/pasta era irrestrita — agora restrita a raízes
  registradas; sem CSP — adicionada CSP restritiva; comandos já usavam `argv` estruturado
  (nunca strings de shell com entrada do usuário) — mantido e reforçado pela validação de
  payload.
- Script `test` do `package.json` apontava para arquivo movido (quebrado) — atualizado.
- Caso E2E "arquivo direto MP4": saída truncada (261 bytes) por `moov` no fim do arquivo
  sem suporte a Range no servidor local — geração do fixture agora usa `-movflags +faststart`.
- Caso E2E "DASH": temp files do demuxer (`init-*.mp4`, `seg-*.m4s`) poluíam a raiz do
  repositório — o processo CLI roda com `cwd` no diretório temporário do teste.
