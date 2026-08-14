# StreamGrab — Estrutura do Projeto

## Visão Geral

O **StreamGrab** é um baixador de vídeos universal para **HLS (.m3u8), DASH (.mpd), YouTube, redes sociais e outras fontes**, usando **FFmpeg** e **yt-dlp**. Funciona como **CLI em Node.js** com interface **Electron** opcional.

---

## Estrutura de Diretórios

### 📁 Diretórios Raiz

| Diretório | Descrição | Arquivos Principais |
|-----------|-----------|---------------------|
| **`src/`** | Código-fonte principal (lógica de negócio) | `index.js`, `hls.js`, `dash.js`, `ffmpeg.js`, etc. |
| **`electron/`** | Interface gráfica (Electron) | `main.js`, `renderer.js`, `preload.cjs`, etc. |
| **`tests/`** | Testes unitários, integração e e2e | `unit/`, `integration/`, `e2e/`, `fixtures/`, `performance/` |
| **`scripts/`** | Scripts de instalação e build | `install-ffmpeg.mjs`, `install-electron.mjs`, etc. |
| **`docs/`** | Documentação do projeto | `architecture.md`, `performance.md`, `roadmap.md` |
| **`tools/`** | Binários e scripts curl-impersonate | `curl-impersonate.exe`, scripts `.bat` para diferentes navegadores |
| **`vendor/`** | Binários externos (FFmpeg) | `ffmpeg/` |
| **`bin/`** | Ponto de entrada CLI para npm | `streamgrab.mjs` |
| **`plan/`** | Planos de desenvolvimento | `MULTI_AUDIO_SUBTITLES_SPEC.md`, `goal/` |

---

## 📁 `src/` — Código-Fonte Principal

### Arquivos Raiz do `src/`

| Arquivo | Função | Por que é principal |
|---------|--------|---------------------|
| `index.js` | Ponto de entrada CLI | Inicia a aplicação, parseia subcomandos (`analyze`, `download`), e roda o fluxo interativo. |
| `hls.js` | Parser HLS | Analisa playlists `.m3u8`, encontra variantes de qualidade e metadados. |
| `dash.js` | Parser DASH | Analisa manifests `.mpd`, extrai informações de stream. |
| `mdstrm.js` | Suporte a Mídia Stream | Lógica específica para URLs `mdstrm.com` (refresh de tokens, detecção). |
| `ffmpeg.js` | Integração FFmpeg | Executa comandos FFmpeg para download e mux de vídeo+áudio. |
| `curlimp.js` | curl-impersonate | Cliente HTTP que imita navegadores (Chrome, Firefox) para evitar bloqueio de CDNs. |
| `source-adapters.js` | Adaptadores de fonte | Detecta automaticamente a origem e roteia para o adaptador correto. |
| `cli-flow.js` | Fluxo interativo | Gerencia a sessão do usuário (escolha de qualidade, opções de download). |
| `input.js` | Entrada do usuário | Coleta input do usuário (URL, opções). |
| `utils.js` | Utilitários | Funções auxiliares gerais. |

### 📁 `src/core/` — Módulos Centrais

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| `engine.js` | Motor de download | Coordena o download real: analisa URLs, escolhe variantes, gerencia workers paralelos. |
| `events.js` | Sistema de eventos | Comunicação entre módulos (downloads, logs, erros). |
| `errors.js` | Tratamento de erros | Mapeamento de erros para mensagens amigáveis. |
| `logger.js` | Sistema de logs | Logging estruturado para debug e diagnóstico. |
| `history.js` | Histórico de downloads | Armazena e recupera histórico de downloads realizados. |
| `filenames.js` | Nomes de arquivo | Geração de nomes de arquivo para downloads. |
| `format-utils.js` | Utilitários de formato | Funções para trabalhar com formatos de vídeo/áudio. |
| `header-utils.js` | Utilitários de headers | Manipulação de headers HTTP. |
| `binaries.js` | Gerenciamento de binários | Localização e validação de binários externos (FFmpeg, curl). |
| `disk.js` | Operações de disco | Leitura/escrita de arquivos, espaço em disco. |
| `atomic.js` | Operações atômicas | Escrita segura de arquivos (evita corrupção). |

### 📁 `src/cli/` — Interface de Linha de Comando

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| `commands.js` | Subcomandos CLI | Implementa `analyze`, `download`, `help`. |
| `config.js` | Configuração | Carrega/salva configurações do usuário (`config.json`). |
| `context.js` | Contexto da sessão | Estado compartilhado durante a sessão CLI. |
| `download.js` | Lógica de download CLI | Fluxo de download para interface de linha de comando. |
| `progress.js` | Barra de progresso | Exibe progresso do download no terminal. |
| `render.js` | Renderização CLI | Formatação de saída no terminal. |
| `turbo.js` | Modo turbo | Download paralelo para URLs diretas. |
| `ui.js` | Interface do usuário | Componentes de UI para o terminal. |

### 📁 `src/adapters/` — Adaptadores de Fonte

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| `youtube.js` | Adaptador YouTube | Integração com yt-dlp para YouTube e redes sociais. |
| `social.js` | Adaptador Redes Sociais | Suporte a Facebook, Instagram, TikTok, X/Twitter, etc. |
| `ytdlp.js` | Wrapper yt-dlp | Interface para o binário yt-dlp. |

### 📁 `src/ffmpeg/` — Módulos FFmpeg

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| *(diversos)* | Módulos FFmpeg | Funções específicas para diferentes operações FFmpeg. |

### 📁 `src/providers/` — Provedores de Fonte

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| *(diversos)* | Provedores | Lógica específica para diferentes provedores de conteúdo. |

### 📁 `src/transports/` — Transportes de Dados

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| *(diversos)* | Transportes | Diferentes métodos de transferência de dados (HTTP, curl, etc.). |

### 📁 `src/legacy/` — Código Legado

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| *(diversos)* | Código legado | Código antigo mantido para compatibilidade. |

---

## 📁 `electron/` — Interface Gráfica

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| `main.js` | Processo principal | Janela principal, IPC entre frontend/backend, integração com serviços core. |
| `renderer.js` | Processo de renderização | Interface gráfica do Electron (HTML/JS). |
| `preload.cjs` | Pré-carregamento | Segurança e ponte entre processos main/renderer. |
| `index.html` | HTML principal | Estrutura da interface gráfica. |
| `styles.css` | Estilos | CSS da interface gráfica. |
| `services.js` | Serviços compartilhados | Serviços usados pelo Electron (Core, Queue, Settings, History). |
| `security.js` | Validação de segurança | Validação de payloads IPC para prevenir ataques. |
| `media-info.js` | Informações de mídia | Normalização de informações de mídia para o frontend. |

---

## 📁 `tests/` — Testes

| Diretório | Tipo | Descrição |
|-----------|------|-----------|
| `unit/` | Testes unitários | Testes isolados de módulos individuais. |
| `integration/` | Testes de integração | Testes que verificam interação entre módulos. |
| `e2e/` | Testes ponta a ponta | Testes completos do fluxo do usuário. |
| `fixtures/` | Dados de teste | Arquivos de exemplo usados nos testes. |
| `performance/` | Testes de desempenho | Testes de benchmark e performance. |

---

## 📁 `scripts/` — Scripts de Build e Instalação

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| `install-ffmpeg.mjs` | Instala FFmpeg | Baixa e instala FFmpeg localmente (Windows). |
| `install-electron.mjs` | Instala Electron | Valida e repara instalação do Electron. |
| `install-curl-impersonate.mjs` | Instala curl-impersonate | Baixa e configura curl-impersonate. |
| `package-resources.mjs` | Empacota recursos | Prepara recursos para build do Electron. |
| `checksums.mjs` | Gera checksums | Calcula hashes para distribuição. |
| `update-ytdlp.mjs` | Atualiza yt-dlp | Baixa versão mais recente do yt-dlp. |

---

## 📁 `tools/` — Ferramentas Externas

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| `curl-impersonate.exe` | Binário curl-impersonate | Cliente HTTP que imita navegadores. |
| `curl_chrome*.bat` | Scripts Chrome | Scripts para imitar diferentes versões do Chrome. |
| `curl_firefox*.bat` | Scripts Firefox | Scripts para imitar diferentes versões do Firefox. |
| `curl_safari*.bat` | Scripts Safari | Scripts para imitar diferentes versões do Safari. |
| `curl_edge*.bat` | Scripts Edge | Scripts para imitar diferentes versões do Edge. |
| `curl_tor*.bat` | Scripts Tor | Scripts para imitar o Tor Browser. |

---

## 📁 `docs/` — Documentação

| Arquivo | Função | Descrição |
|---------|--------|-----------|
| `architecture.md` | Arquitetura | Documentação da arquitetura do sistema. |
| `performance.md` | Performance | Notas sobre desempenho e otimizações. |
| `roadmap.md` | Roadmap | Plano de desenvolvimento futuro. |

---

## 📁 Outros Diretórios

| Diretório | Descrição |
|-----------|-----------|
| `bin/` | Ponto de entrada CLI para instalação via npm (`streamgrab.mjs`). |
| `plan/` | Planos de desenvolvimento e especificações de features. |
| `vendor/` | Binários externos (FFmpeg). |
| `dist/` | Arquivos de distribuição (builds do Electron). |
| `build/` | Configurações de build para electron-builder. |
| `.github/` | Configurações do GitHub (CI/CD, templates). |
| `tmp-electron-test/` | Arquivos temporários para testes do Electron. |

---

## Fluxo Básico

### CLI
```
src/index.js → cli-flow.js → engine.js → ffmpeg.js/curlimp.js
```

### Electron
```
electron/main.js → engine.js → serviços compartilhados
```

### Detecção Automática
```
source-adapters.js identifica a fonte → escolhe adaptador (HLS, DASH, YouTube, etc.)
```

---

## Resumo da Organização

O projeto é **modular** e **bem organizado**:

- **`src/`** contém toda a lógica de negócio, dividida em módulos com responsabilidades claras
- **`electron/`** fornece a interface gráfica, compartilhando o core com o CLI
- **`tests/`** garante qualidade com diferentes níveis de testes
- **`scripts/`** automatiza instalação e build
- **`tools/`** e **`vendor/`** mantêm binários externos organizados

Cada diretório tem um propósito específico, facilitando manutenção, navegação e desenvolvimento.