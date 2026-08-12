# Contribuindo com o StreamGrab

Obrigado por considerar contribuir com o StreamGrab! Este guia cobre o setup, a
arquitetura, como criar um provider, testes, estilo e Pull Requests.

---

## Setup

Requisitos:

- **Node.js 20+**
- **Windows 10/11** (plataforma principal; macOS/Linux funcionam, mas não são o alvo do instalador nesta fase)
- **FFmpeg** — no Windows é baixado automaticamente pelo `npm install` (para `vendor/ffmpeg/`); em macOS/Linux instale manualmente e adicione ao PATH

```powershell
git clone <seu-fork>
cd streamgrab
npm install
```

O `postinstall` valida o Electron e o FFmpeg. Para reparar manualmente:

```powershell
npm run electron:install   # repara/instala o Electron local
npm run ffmpeg:install     # baixa o FFmpeg para vendor/ffmpeg (Windows)
```

## Comandos úteis

```powershell
npm test                  # suite completa: unit + integration + E2E
npm run test:unit         # somente testes unitários
npm run test:integration  # somente testes de integração
npm run test:e2e          # somente E2E (curl-e2e)
npm run lint              # ESLint (0 erros; avisos pré-existentes documentados)
npm run format            # Prettier (--write)
```

## Arquitetura (visão geral)

```
src/
  core/          # Modelos, erros, eventos, engine, resume, smart-turbo, settings
  providers/     # ProviderRegistry + providers normalizados (hls, dash, direct, ytdlp)
  transports/    # Estratégias de transporte (range paralelo, http)
  cli/           # Fluxos da CLI (download, turbo, curl-flow, comandos P9, render)
  ffmpeg/        # FfmpegService, muxer, audio
  adapters/      # Adaptadores legados (youtube, social, ytdlp)
  legacy/        # Código morto em produção (apenas testes) — remover quando migrado
  cli-flow.js    # Orquestração compartilhada CLI/Electron (runCliSession)
bin/streamgrab.mjs  # Entry point da CLI (streamgrab <url> | analyze | download)
electron/           # Aplicativo desktop (main/preload/renderer) — consome o mesmo core
```

Fluxo conceitual:

```
URL → ProviderRegistry.detect → provider.analyze → MediaInfo → Format[]
    → DownloadEngine → Transport (Range/HTTP/FFmpeg/yt-dlp) → FFmpeg (mux) → arquivo final
```

CLI e Electron consomem **o mesmo core** (`StreamGrabCore` / `runCliSession`).
O Electron **não** duplica lógica de download.

## Como criar um provider

Providers ficam em `src/providers/<id>/` e são registrados no `src/providers/registry.js`.

Contrato mínimo (ver `src/providers/hls/index.js` como exemplo):

```js
export const meuProvider = {
  id: 'meu-id',
  label: 'Meu Provider',
  priority: 80, // ordem de detecção (maior testa antes)
  supportsQualitySelection: false,

  detect(url) {
    // Retorna true se esta URL pertence a este provider.
    return /algum-padrao/.test(url);
  },

  async analyze({ url, headers }) {
    // Retorna MediaInfo normalizado (createMediaInfo + variants/formats).
    // Nunca reinvente o download aqui — analise apenas.
    // Detecte DRM e lance UnsupportedDrmError (veja providers/*/drm.js).
    return { ...createMediaInfo({ kind: 'media', sourceType: 'meu-id', provider: 'meu-id' }) };
  },

  getFormats(media) {
    // MediaInfo → Format[] (createFormat).
  },

  async prepareDownload({ url, ... }) {
    // Resolve a URL final (ou { strategy: 'mux', videoUrl, audioUrl }).
    return { downloadUrl: url };
  },
};
```

Regras:

- **Nunca implemente bypass de DRM** — detecte e lance `UnsupportedDrmError`.
- **Não reimplemente extractors do yt-dlp** — se a fonte é coberta pelo yt-dlp, use o provider `ytdlp`.
- **Não adicione dependências sem justificar** no PR.
- **Fallback ≠ bypass**: 401/403/DRM nunca viram loop de transports.

## Testes

- **Unit** (`tests/unit/`) — módulos puros: detecção, parsing, classificação de erros, chunk planning, resume state, smart turbo.
- **Integration** (`tests/integration/`) — servidores HTTP **locais** (fixtures em `tests/fixtures/`): HLS/DASH locais, Range server, fallback de transport. Sem rede externa.
- **E2E** (`tests/e2e/`) — fluxos estáveis e controláveis.
- **Performance** (`tests/performance/`) — baselines reproduzíveis (turbo e core).

Regras:

1. Crie/ajuste os testes **antes** das mudanças quando possível.
2. Não persiga cobertura artificial — teste comportamento e fronteiras importantes.
3. Nunca esconda um teste quebrado; se quebrar, reporte a regressão no PR.
4. Use `node:test` + `node:assert/strict` (sem dependências extras de runner).

## Estilo

- ESLint + Prettier: `npm run lint` deve terminar com **0 erros** (os 6 avisos pré-existentes são baseline e não devem aumentar).
- ESM (`"type": "module"`); sem transpilação.
- Sem TypeScript nesta migração (reavaliado no roadmap).
- Mensagens de erro: amigáveis para a UI (`message`), técnica em `detail`; use a taxonomia de `src/core/errors.js` e o `friendlyReport()` — nunca strings soltas na UI.
- Logs: **nunca** registre secrets (cookies, tokens, Authorization, URLs assinadas completas).

## Pull Requests

1. Baseie o PR em `main` e descreva o problema/feature e a abordagem.
2. Faça commits pequenos e logicamente separáveis (uma mudança por commit).
3. Rode `npm test` e `npm run lint` antes de abrir — inclua os resultados no PR.
4. Se alterar comportamento, atualize `CHANGELOG.md` e a documentação afetada.
5. Não altere o escopo silenciosamente — mudanças maiores merecem um issue/ADRs primeiro.

O CI (GitHub Actions) roda install + lint + unit tests + integration em PRs;
builds/releases acontecem apenas em tags (ver `docs/roadmap.md`).
