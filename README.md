<div align="center">

# StreamGrab

**Fast, universal video downloader for HLS, DASH, YouTube and other supported sources.**

| 🇧🇷 [Português](#pt) | 🇺🇸 [English](#en) | 🇪🇸 [Español](#es) |
|---|---|---|

</div>

---

<h2 id="pt">🇧🇷 Português</h2>

Aplicativo **CLI em Node.js** (com interface **Electron** opcional) para baixar vídeos de **HLS (.m3u8)**, **DASH (.mpd)**, **YouTube**, **redes sociais**, **arquivos diretos** e **outras fontes suportadas** (qualquer site coberto pelo motor yt-dlp) usando o **FFmpeg**, de forma simples e segura no Windows. Suporta Mídia Stream (mdstrm) via curl-impersonate, download paralelo (turbo) em URLs diretas e mux de vídeo+áudio para máxima qualidade.

> ⚠️ **Uso responsável**
> Esta ferramenta trabalha **somente** com URLs que você mesmo fornece e para as quais você já tem **acesso legítimo e autorizado** pela plataforma. Ela **não** faz bypass de DRM (Widevine etc.), não burla autenticação, não captura cookies do navegador, não descobre credenciais e não tenta acessar nada além do que a URL fornecida já permite.

---

### Requisitos

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **Windows 10/11** (também funciona em macOS/Linux)
- **FFmpeg** — no Windows é baixado **automaticamente** pelo `npm install` (para `vendor/ffmpeg/`). Em macOS/Linux, instale manualmente e adicione ao PATH.

> 💡 O `npm install` roda scripts (`postinstall`) que validam o Electron e o FFmpeg. No Windows, o FFmpeg é baixado e instalado localmente em `vendor/ffmpeg/`. Em macOS/Linux, o instalador apenas espera que `ffmpeg` já exista no PATH. Para reparar o Electron manualmente: `npm run electron:install`. Para instalar/atualizar o FFmpeg local no Windows: `npm run ffmpeg:install`.

---

### Instalação

```powershell
cd streamgrab
npm install
```

Linux:

```bash
sudo apt install ffmpeg unzip
npm install
```

macOS:

```bash
brew install ffmpeg
npm install
```

> O programa em si **não usa dependências de runtime** — dá para rodar direto com `node src/index.js` sem `npm install`. O `npm install` instala apenas o **ntl** (menu opcional de scripts) como dependência de desenvolvimento. Exceção: para downloads do **YouTube** e de **redes sociais**, o `npm install` também baixa o binário standalone do **yt-dlp** (pacote `youtube-dl-exec`) na primeira instalação.

> **Redes sociais:** além de YouTube, o adaptador social (motor yt-dlp) cobre **Facebook, Instagram, TikTok, X/Twitter, Reddit, Twitch, Vimeo, Dailymotion, LinkedIn, Bilibili, VK** e os demais sites suportados pelo yt-dlp (a lista muda com frequência — consulte a documentação do yt-dlp). Basta colar a URL do post/vídeo — o programa detecta a plataforma automaticamente e oferece as qualidades disponíveis. Conteúdo privado/login funciona com cookies (veja a seção [Conteúdo privado / autenticado](#-conteúdo-privado--autenticado-login)) e conteúdo com DRM não é suportado.

---

### Como executar

**Recomendado (contorna CDNs com bloqueio de cliente não-navegador, como a Mídia Stream):**

```powershell
npm run download:curl
```

Básico (fluxo interativo):

```powershell
node src/index.js
```

Ou use o binário `streamgrab` (disponível no PATH quando instalado via npm) com subcomandos:

```powershell
streamgrab <url>                      # interativo (compatibilidade)
streamgrab analyze <url> [--json]     # análise não-interativa da URL
streamgrab download <url> [--output <dir>] [--turbo] [--chunks <n>]  # download não-interativo
streamgrab help                       # ajuda dos subcomandos
```

#### Exemplo de uso completo

```
==============================================
   StreamGrab — HLS / DASH / YouTube / Redes
==============================================

Verificando FFmpeg...
FFmpeg OK.

URL do .m3u8: https://exemplo.com/aula/playlist.m3u8?cP=1997000&access_token=abc&sid=xyz
URL reconhecida: https://exemplo.com/aula/playlist.m3u8?cP=1997000&access_token=***&sid=***

Analisando playlist...

Qualidades encontradas:
  1. 1920x1080 (1080p)  ~1.75 Mbps
  2. 1280x720 (720p)  ~0.90 Mbps
  3. 854x480 (480p)  ~0.50 Mbps
  4. 640x360 (360p)  ~0.30 Mbps
  5. 426x240 (240p)  ~0.15 Mbps
  0. Cancelar

Escolha (Enter = melhor disponível): 2
Variant escolhida: https://exemplo.com/aula/720p/index.m3u8?access_token=***

Nome do arquivo (sem extensão): Aula 01
Pasta de saída (Enter = C:\Users\SeuUsuario\Downloads):
Salvando em: C:\Users\SeuUsuario\Downloads\Aula 01.mp4

Baixando — modo: cópia direta (-c copy)
Baixando...  Tempo: 00:12:43  Tamanho: 184.0 MB  Velocidade: 6.2x
✅ Download concluído!
Arquivo salvo em: C:\Users\SeuUsuario\Downloads\Aula 01.mp4
```

#### Argumentos de linha de comando

```powershell
node src/index.js --referer "https://exemplo.com/" --origin "https://exemplo.com" --user-agent "Mozilla/5.0 ..."
```

- `--referer <URL>` — envia o header `Referer`
- `--origin <URL>` — envia o header `Origin`
- `--user-agent "<UA>"` — envia o header `User-Agent`
- `--curl-impersonate` / `--ci` — força o modo curl-impersonate
- `--cookies <arquivo>` — usa um `cookies.txt` (formato Netscape) para conteúdo autenticado (YouTube privado, redes sociais com login)
- `--cookies-from-browser <navegador>` — extrai cookies automaticamente do navegador (`chrome`, `edge`, `firefox`, `brave`, `opera`, `vivaldi`, `chromium`...)
- `--turbo` — download paralelo por partes (HTTP Range) em URLs diretas (YouTube/redes sociais/arquivos). Mais rápido: várias conexões ao mesmo tempo
- `--chunks <n>` — número de conexões do modo turbo (padrão: 8)
- `--smart-turbo` / `--no-smart-turbo` — liga/desliga o Smart Turbo (concurrency adaptativa)
- `--youtube` — força o adaptador do YouTube (usado por `npm run download:youtube`)
- `--help` — mostra a ajuda

Os mesmos headers podem ser definidos em um arquivo `config.json` na pasta do projeto (veja `config.example.json`). Os valores informados na linha de comando têm prioridade sobre o arquivo.

---

### 🔐 Conteúdo privado / autenticado (login)

Sim, dá para baixar vídeos **privados** (ex.: "não listado"/privado no YouTube, post restrito no Facebook/Instagram) **desde que você tenha acesso autenticado** — o programa usa os cookies da sua sessão:

1. **Exporte os cookies** do navegador enquanto estiver logado no site:
   - Instale a extensão **"Get cookies.txt LOCALLY"** (Chrome/Edge/Firefox)
   - Abra a página do vídeo, clique na extensão e exporte o `cookies.txt`
2. **Use o arquivo** de uma destas formas:

   ```powershell
   # Linha de comando (o arquivo deve estar na pasta do projeto)
   node src/index.js --cookies cookies.txt

   # Ou no config.json (aplicado a todas as execuções)
   # { "cookiesFile": "cookies.txt" }
   ```

3. **Ou extraia direto do navegador** (sem exportar nada):

   ```powershell
   node src/index.js --cookies-from-browser chrome
   ```

O programa então analisa e baixa usando a sua sessão. Se o conteúdo exigir login e não houver cookies, ele avisa com instruções.

> ⚠️ **Limitações:** (1) conteúdo protegido por **DRM** (Widevine/PlayReady, comum em serviços de streaming) continua não suportado; (2) contas com **verificação em duas etapas (2FA)** às vezes exigem extração do navegador em vez de cookies.txt; (3) use apenas conteúdo ao qual você tem direito de acesso.

---

### ⚡ Modo turbo (download mais rápido)

Por padrão o download usa **1 conexão** (FFmpeg) — o limite de velocidade fica no servidor por conexão. O **turbo** divide o arquivo em partes e baixa **várias conexões em paralelo** (estilo IDM/aria2), contornando esse limite:

```powershell
node src/index.js --turbo                 # 8 conexões paralelas (padrão)
node src/index.js --turbo --chunks 16     # 16 conexões
```

Funciona em **URLs diretas**: YouTube (progressivo e adaptativo — vídeo+áudio baixam **ao mesmo tempo**), redes sociais e arquivos `.mp4`/`.webm`. Não se aplica a HLS (`.m3u8`) nem DASH (`.mpd`).

- Se o servidor **não suportar** download por partes (sem `Accept-Ranges`), o turbo detecta e **volta automaticamente** ao fluxo normal — sem erro.
- Também pode ser ligado por padrão no `config.json`: `{ "turbo": true, "turboChunks": 8 }`.
- No **Electron**, é uma caixa "⚡ Turbo" em cada aba.

### 🧠 Smart Turbo (concurrency adaptativa)

O **Smart Turbo** (P6.2) ajusta o número de conexões **durante** o download, orientado por benchmark (`tests/performance/BASELINE.md`): sobe em rampa (2→4→8→12) enquanto o throughput por conexão se mantém, e **reduz com backoff** ao detectar throttling (queda > 30% do por-conexão com total estagnado) ou erros 429/5xx — sem induzir bloqueios no servidor. Em links rápidos ele encontra o teto do seu link; em servidores limitados, para de desperdiçar conexões.

```powershell
node src/index.js --turbo --chunks 12            # pool fixo (comportamento anterior)
node src/index.js --turbo --smart-turbo          # adaptativo (max 12)
node src/index.js --turbo --no-smart-turbo       # rollback explícito por CLI
```

No `config.json`/settings:

```jsonc
{ "turbo": true, "turboChunks": 12, "smartTurbo": true }
// ou com opções: { "smartTurbo": { "min": 2, "max": 8, "windowMs": 800 } }
```

- Padrão: **desligado** (pool fixo). `--no-smart-turbo` desliga mesmo com config ativa (rollback).
- A cada janela de medição (default 1200 ms) o pool decide: subir (rampa/crescimento sustentado), reduzir (throttling/erros) ou manter.

> 💡 Ganho típico: **2–10x** em conexões rápidas (o teto vira o seu link, não o throttling por conexão do servidor).

---

### 🎬 Download do YouTube (melhor resolução)

```powershell
npm run download:youtube
```

Cole uma URL de vídeo do YouTube (ex.: `https://www.youtube.com/watch?v=...` ou `https://youtu.be/...`). O programa lista as **qualidades encontradas** (2160p/1440p/1080p/720p/...) e baixa a escolhida na **melhor resolução disponível** — para vídeos 4K, baixa o vídeo e o melhor áudio separadamente e **junta com o FFmpeg** (`-c copy`, sem perda de qualidade).

```
Qualidades encontradas:
  1. 2160p  ~13.47 Mbps
  2. 2160p  ~9.02 Mbps
  3. 1440p  ~5.67 Mbps
  4. 1080p  ~3.04 Mbps
  ...
  0. Cancelar

Escolha (Enter = melhor disponivel): 
```

> ℹ️ A resolução do YouTube é resolvida pelo **yt-dlp** (binário standalone, baixado automaticamente na instalação pelo pacote `youtube-dl-exec` — sem precisar de Python). O yt-dlp mantém atualizada a lógica de decifração de assinaturas, transformação do parâmetro `n`, tokens de prova de origem (POT) e o novo streaming SABR do YouTube, que quebram implementações caseiras com frequência. Os links gerados são baixados pelo FFmpeg local, com os mesmos modos de fallback do restante do programa.

---

### Como obter uma Request URL `.m3u8` pelo DevTools

1. Acesse a plataforma e **inicie a reprodução** da aula no navegador (Chrome/Edge).
2. Pressione `F12` para abrir o DevTools.
3. Vá para a aba **Network** (Rede).
4. No campo de filtro, digite `m3u8` (ou `media`).
5. Dê **play/pause** no vídeo (ou recarregue a página) para gerar as requisições.
6. Clique na requisição que termina em `.m3u8` — ela pode aparecer como `index.m3u8`, `master.m3u8`, `playlist.m3u8` etc.
7. Clique com o botão direito → **Copy → Copy request URL** e cole no programa.

> 💡 **Os tokens expiram rápido** (minutos, às vezes segundos). Cole a URL e execute o download logo em seguida. Se o download falhar com 403, obtenha uma URL nova.

---

### Master playlist × Variant playlist

| Tipo | O que contém | Exemplo de linha |
|---|---|---|
| **Master** | Lista de variantes (resoluções) | `#EXT-X-STREAM-INF:BANDWIDTH=1753000,RESOLUTION=1920x1080` |
| **Variant** | Os segmentos `.ts`/`.m4s` do vídeo em si | `#EXTINF:6.000000,` |

- Se você colar uma **master**, o programa lista as resoluções encontradas (1080p, 720p, 480p…) e deixa você escolher, ou escolhe a **melhor disponível** (Enter).
- Se você colar uma **variant**, o programa usa diretamente.
- URLs relativas dentro da playlist são resolvidas corretamente contra a master (`new URL(childUrl, masterUrl)`).

---

### Como escolher 1080p

Cole a master `.m3u8` → quando aparecer a lista de qualidades, digite o número da opção `1920x1080` (ou aperte **Enter** para a melhor disponível, que normalmente já é a 1080p).

Se a plataforma não oferecer 1080p na lista, nenhuma opção vai "criar" essa resolução — o download usa o que está disponível.

---

### O que significa o erro 403

O servidor **recusou a requisição**. As causas mais comuns:

1. **Token expirado** — a URL temporária deixou de valer. Obtenha uma nova Request URL no DevTools.
2. **Headers ausentes** — o servidor exige headers iguais aos do navegador (`Referer`, `Origin`, `User-Agent`). Configure-os em `config.json` ou pelos argumentos `--referer`/`--origin`/`--user-agent`.
3. **CDN com bloqueio de cliente não-navegador** — alguns CDNs (ex.: **mediastre.am / MediastreamCDN**, usado pela plataforma Mídia Stream) usam *fingerprinting TLS*: o servidor identifica que a requisição não veio de um navegador real (Chrome/Firefox) e responde `403` mesmo com tokens válidos e headers corretos. **Nesse caso o download via FFmpeg é recusado pelo próprio servidor** — mas o modo curl-impersonate resolve (veja abaixo), desde que você use a **URL do player** (com `at=web-app` + as variáveis `uid/sid/pid/av` do console), não a URL crua do CDN (que dá `403` até no navegador).

O programa **não** tenta burlar nada disso: sem token novo ou sem acesso do servidor, não há download.

---

### Modo curl-impersonate (contornar bloqueio de cliente não-navegador)

Para CDNs com *fingerprinting TLS* (item 3 acima), o programa oferece um modo extra que **imita o TLS de um navegador real (Chrome)** ao fazer as requisições. O FFmpeg entra apenas para **remuxar os arquivos localmente** — ele não toca na rede, então o bloqueio não se aplica.

#### Como funciona

1. O programa detecta/usa o binário **curl-impersonate** — formato **v2.x** (`curl-impersonate.exe` + perfis `curl_<browser><versão>.bat`; o formato antigo v1.x, `curl_chrome*.exe`, também é suportado).
2. Ele baixa a master playlist e a playlist de segmentos com o TLS imitado (perfil `chrome146` por padrão, com lista de fallback).
3. Baixa os **segmentos** (e chaves AES-128 / init segments, se houver) em paralelo, com tentativas.
4. Gera uma **playlist local** apontando para os arquivos baixados e o FFmpeg faz o remux para `.mp4` (com o mesmo fallback de modos: `-c copy` → `aac_adtstoasc` → `-c:a aac`).

#### Como ativar

- **Automaticamente:** ao receber `403`, o programa pergunta se você quer tentar o modo curl-impersonate.
- **Forçado:** rode com `npm run download:curl` (ou `node src/index.js --curl-impersonate`, ou `--ci`).

#### Instalação do curl-impersonate (Windows)

1. Acesse <https://github.com/lexiforest/curl-impersonate/releases> (projeto original: <https://github.com/lwthiker/curl-impersonate>) e baixe o pacote para Windows (ex.: `curl-impersonate-win64.zip`).
2. Extraia o ZIP — o formato **v2.x** traz `curl-impersonate.exe` + vários `curl_chromeNNN.bat` / `curl_edgeNNN.bat` / `curl_firefoxNNN.bat`.
3. Copie a pasta para **uma** destas opções:
   - dentro deste projeto, em `streamgrab\tools\`; ou
   - adicione a pasta ao PATH do Windows.
4. Rode novamente com `npm run download:curl`.

> ⚠️ **Importante:** o curl-impersonate **não** contorna DRM (Widevine etc.) e **não** automatiza login nem captura cookies — ele apenas faz a conexão TLS parecer um navegador, usando a mesma URL que você já tem acesso. **Confira os termos de uso da plataforma** antes de usar, pois o download pode não ser permitido por ela.

---

### Fluxo mdstrm / MediastreamCDN (plataforma Mídia Stream)

O player da Mídia Stream (`mdstrm.com`) protege os vídeos com um **token curto (OTE) + vars de sessão** que são gerados quando a página carrega. **Copiar a URL de um `.m3u8` direto do DevTools dá `403` para tudo** (até para um navegador real), porque as variáveis (`pid`, `sid`, `uid`, `access_token`) daquela URL são amarradas à sessão do player e expiram/ficam inválidas fora dela.

#### ✅ O programa converte automaticamente

Se você colar uma URL do CDN (`...cdn.mdstrm.com/...`) ou uma URL do player sem as variáveis, o programa **detecta sozinho** e converte para a URL do player — buscando as variáveis frescas na página pública do embed (`mdstrm.com/embed/<videoId>`), sem login nem cookies:

```
[mdstrm] URL da Mídia Stream detectada (videoId 6a03573096d73ba91827573a).
[mdstrm] Buscando credenciais do player no embed público para gerar tokens frescos...
[mdstrm] URL do player gerada: https://mdstrm.com/video/6a03573096d73ba91827573a.m3u8?at=web-app&uid=***&sid=***&pid=***&av=v7.0.86
```

**Basta colar a URL que você copiou do DevTools e dar Enter** — o restante é automático. Lembre de usar `--curl-impersonate` (ou `npm run download:curl`).

#### Manual (opcional, se a conversão automática falhar)

1. Abra a página do vídeo na plataforma (ex.: `https://mdstrm.com/embed/<videoId>`) **ou** a página da aula no site.
2. No DevTools, console, leia as variáveis do player: `MDSTRMUID`, `MDSTRMSID`, `MDSTRMPID`, `VERSION` (ex.: `v7.0.86`).
3. Monte a URL do player:

   ```
   https://mdstrm.com/video/<videoId>.m3u8?at=web-app&uid=<MDSTRMUID>&sid=<MDSTRMSID>&pid=<MDSTRMPID>&av=<VERSION>
   ```

4. Cole **essa** URL no programa (com `--curl-impersonate`). O servidor responde com a master playlist contendo **tokens frescos** por variante; o programa baixa tudo e remuxa para `.mp4`.

> 💡 Os tokens gerados duram algumas horas; se der `403` no meio, o próprio programa refaz a conversão na próxima execução.
> 🔒 **Limite honesto:** DRM (Widevine/PlayReady) não é contornado — isso só funciona com vídeos de streaming HLS comum.

---

### Onde o vídeo é salvo

- Por padrão, na pasta **Downloads do usuário** do Windows (obtida programaticamente via `os.homedir()` — nenhum nome de usuário é fixado no código).
- Você pode digitar outra pasta no prompt; se ela não existir, o programa a cria.
- O nome do arquivo é **sanitizado** (caracteres inválidos do Windows como `< > : " / \ | ? *` são substituídos) e a extensão `.mp4` é adicionada automaticamente.
- Se o arquivo já existir, o programa pergunta: **S**obrescrever / **N**ovo nome / **C**ancelar.

---

### Qualidade e compatibilidade do MP4

1. Primeira tentativa: `-c copy` — **sem recodificação**, sem perda de qualidade (remux direto).
2. Se o MP4 apresentar incompatibilidade de áudio, tenta `-c copy -bsf:a aac_adtstoasc` (correção de container, ainda sem recodificar).
3. Por último, tenta `-c:v copy -c:a aac` (reconverte apenas o áudio para AAC, preservando o vídeo).

A conversão de áudio só é usada **quando necessário**.

---

### Segurança dos tokens

- Parâmetros sensíveis da URL (`token`, `access_token`, `authorization`, `auth`, `sid`, `uid`, `signature`, `sig`, `key` etc.) têm os valores **mascarados** (`***`) em toda exibição.
- A URL completa **nunca** é registrada em logs. O `downloads.log` (gerado na pasta do projeto) registra apenas data, nome do arquivo, qualidade usada e a URL **mascarada**.
- O que você cola no prompt vai direto para o Node (modo raw do terminal) — o PowerShell não interpreta `&`, `?`, `=`, `%` da URL, então **cole sem se preocupar com escaping**. Não monte comandos FFmpeg manualmente no PowerShell.
- **URL pela área de transferência:** se você apertar `Enter` vazio no prompt "URL do .m3u8", o programa lê automaticamente a URL copiada do clipboard (Windows). Útil quando o colar não funciona (ex.: rodando via `ntl`).

---

### Interromper com Ctrl+C

Pressione `Ctrl+C` a qualquer momento:

- **Durante o prompt**: encerra o programa.
- **Durante o download**: envia o comando de parada ao FFmpeg (finalização graciosa, o arquivo é fechado corretamente) e, se necessário, força a finalização após alguns segundos. **Nenhum processo órfão fica para trás.** Arquivos parciais são removidos.

---

### Estrutura do projeto

```
streamgrab/
  package.json
  config.example.json
  README.md
  bin/
    streamgrab.mjs       # entry point da CLI (`streamgrab` no PATH via npm)
  tools/                # curl-impersonate (v2.x) — usado pelo modo --curl-impersonate
  vendor/ffmpeg/        # FFmpeg local (baixado automaticamente pelo npm install)
  electron/             # interface gráfica (fila, histórico, configurações)
    main.js             # processo principal (IPC fila/histórico/configurações)
    preload.cjs         # ponte segura (contextBridge) para o renderer
    renderer.js         # UI: Vídeos / Fila / Histórico / Configurações
    services.js         # Core + Engine + Queue + Settings + History (Node puro)
    security.js         # validação de payloads dos canais IPC
    index.html / styles.css
  scripts/
    install-ffmpeg.mjs  # baixa/instala o FFmpeg em vendor/ffmpeg/ (postinstall)
    install-electron.mjs# valida a instalação do Electron (postinstall)
    package-resources.mjs # empacota FFmpeg/yt-dlp/curl-impersonate no instalador
    update-ytdlp.mjs    # atualiza o binário do yt-dlp
  tests/
    unit/               # testes unitários (node:test)
    integration/        # testes de integração (servidores locais + FFmpeg)
    e2e/                # suíte E2E: gera HLS local (AES-128/fMP4), MP4 direto, DASH e mdstrm
    performance/        # baselines de performance (BASELINE.md)
  src/
    index.js              # entry da CLI (dispatch analyze/download/interativo)
    cli-flow.js           # orquestração da sessão CLI
    cli/                  # módulos do fluxo CLI
      commands.js         # subcomandos analyze/download/help
      context.js          # contexto, MODE_LABELS, interrupção (Ctrl+C)
      ui.js               # impressões, seleção de variante, nome de arquivo
      progress.js         # barra de progresso (CLI e Electron)
      config.js           # config.json, headers, turbo/smart-turbo
      download.js         # fluxos FFmpeg (direto e mux de vídeo+áudio)
      curl-flow.js        # fluxo curl-impersonate (segmentos HLS)
      turbo.js            # download paralelo por partes (HTTP Range)
    core/                 # núcleo compartilhado CLI + Electron (P2–P11)
      index.js            # API pública (fachada StreamGrabCore)
      engine.js           # DownloadEngine (estados, eventos, disco, atômico)
      queue.js            # fila de downloads persistida (pause/resume/cancel/retry)
      settings.js         # configurações persistentes (settings.json)
      history.js          # histórico persistido (history.json)
      storage.js          # escrita atômica JSON
      atomic.js           # escrita atômica .part → rename
      disk.js             # verificação de espaço em disco
      filenames.js        # nomes seguros de arquivo
      retry.js            # backoff / Retry-After
      strategy.js         # seleção de transporte e fallback
      resources.js        # semáforo / limite de recursos
      resume.js           # retomada de download (ETag/Last-Modified)
      session.js          # reanálise de URL expirada
      smart-turbo.js      # concurrency adaptativa
      models.js / errors.js / events.js / logger.js / binaries.js
    providers/            # provedores de fonte (análise + download)
      registry.js         # ProviderRegistry (descoberta por tipo de URL)
      hls/                # HLS (.m3u8) — parsing, DRM (sem bypass)
      dash/               # DASH (.mpd)
      direct/             # arquivos diretos (mp4/webm/mkv...)
      ytdlp/              # yt-dlp (YouTube, redes sociais, qualquer site suportado)
    transports/           # transportes de rede
      http.js / curl.js / range.js / ytdlp-runner.js
    adapters/             # adaptadores finos de fonte (ytdlp/youtube/social)
    source-adapters.js    # roteamento URL → adaptador
    legacy/               # motor antigo de YouTube (SABR) — apenas E2E
    ffmpeg.js / hls.js / dash.js / curlimp.js / mdstrm.js / input.js / utils.js
```

### Testes

```powershell
npm test                 # unit + integration + E2E
npm run test:unit        # apenas testes unitários
npm run test:integration # apenas testes de integração (servidores locais + FFmpeg)
npm run test:e2e         # suíte E2E completa
npm run lint             # ESLint
```

A suíte E2E (`tests/e2e/curl-e2e.mjs`) gera playlists HLS locais reais com o FFmpeg (MPEG-TS criptografado com AES-128 e fMP4 com EXT-X-MAP), sobe um servidor HTTP local e valida o fluxo completo do modo curl-impersonate — incluindo a detecção v2.x e a conversão de URLs da Mídia Stream. Os testes de integração cobrem o núcleo (facade + engine), a fila/histórico/configurações do Electron (`tests/integration/electron-queue.test.js`), turbo, mux, retry e yt-dlp. O `tools/` real é preservado (backup/restauração automática).

### Menu interativo (opcional, via ntl)

Para não digitar comandos, instale o [ntl](https://www.npmjs.com/package/ntl) (menu de scripts do npm):

```powershell
npm install --save-dev ntl
npx ntl        # abre o menu; escolha download:curl
nt             # reexecuta o último script escolhido
```

### 🖥 Interface Electron (fila, histórico e configurações)

Além do CLI, o app pode ser aberto como interface gráfica (`npm run electron:dev` ou `npm run electron:serve`) com:

- **Vídeos** — abas com análise de URL, escolha de qualidade/variante, pasta de destino e **"Baixar agora"**;
- **Fila** — downloads reais com **concorrência limitada** (1–16 simultâneos), estados *aguardando/baixando/pausado*, **pause/resume/cancelar/tentar novamente/remover** por item e pausa global da fila;
- **Histórico** — registros persistidos de cada download com **abrir arquivo / mostrar na pasta / baixar de novo / remover / limpar**;
- **Configurações** — pasta padrão, downloads simultâneos, turbo, qualidade padrão, áudio, tema, notificações, comando ao concluir e retenção do histórico;
- Fila, histórico e configurações são **persistidos em disco** (`settings.json`, `history.json`, `queue.json`) e restaurados ao reiniciar o app — inclusive com **recuperação de downloads interrompidos** (jobs voltam para a fila como *aguardando*).

### Empacotamento (instalador Windows)

O instalador **StreamGrab-Setup-<versão>.exe** (NSIS) é gerado com o **electron-builder**. Os binários externos (FFmpeg de `vendor/ffmpeg/` — **incluindo as DLLs do build compartilhado**, yt-dlp do pacote `youtube-dl-exec` e, se presente, o curl-impersonate de `tools/`) são empacotados em `extraResources` (pastas `resources/bin/`) — em produção o app resolve os binários por `process.resourcesPath`, então a **máquina-alvo não precisa** de Node.js, FFmpeg ou yt-dlp instalados manualmente.

```powershell
npm run pack:resources   # copia os binários para build/extraResources/bin
npm run dist             # gera dist/StreamGrab-Setup-<versão>.exe (Windows)
npm run dist:dir         # build sem instalador (dist/win-unpacked) — para testar
npm run release          # dist + checksums SHA-256 (dist/SHA256SUMS.txt)
npm run update:ytdlp     # atualiza o binário do yt-dlp (todas as cópias locais)
```

> Requer `npm install` prévio (o `postinstall` baixa FFmpeg/Electron/yt-dlp). CI em PRs: `.github/workflows/ci.yml` (lint + testes + build). Release manual: empurre uma tag `v*` — `.github/workflows/release.yml` gera o instalador, checksums e publica a GitHub Release.

### Limitações (por design)

- Não funciona com vídeos protegidos por DRM (Widevine/PlayReady) ou conteúdo criptografado.
- Não automatiza login nem captura cookies.
- Não descobre nem fabrica tokens.
- Só funciona com URLs que você fornece e às quais você já tem acesso autorizado.

Use apenas para conteúdo que você tem o direito de baixar.

---

<h2 id="en">🇺🇸 English</h2>

A **Node.js CLI application** (with an optional **Electron** interface) to download videos from **HLS (.m3u8)**, **DASH (.mpd)**, **YouTube**, **social networks**, **direct files** and **other supported sources** (any site covered by the yt-dlp engine) using **FFmpeg** — simple and safe on Windows. Supports Mídia Stream (mdstrm) via curl-impersonate, parallel downloads (turbo) on direct URLs and video+audio muxing for maximum quality.

> ⚠️ **Responsible use**
> This tool works **only** with URLs you provide yourself and to which you already have **legitimate, authorized access** from the platform. It does **not** bypass DRM (Widevine etc.), does not circumvent authentication, does not capture browser cookies, does not discover credentials, and does not attempt to access anything beyond what the provided URL already allows.

---

### Requirements

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **Windows 10/11** (also works on macOS/Linux, but automatic FFmpeg installation is Windows-only)
- **FFmpeg** — downloaded **automatically** by `npm install` (into `vendor/ffmpeg/`). Alternatively, install it manually and add it to your PATH.

> 💡 `npm install` runs a script (`postinstall`) that downloads the *essentials* build of FFmpeg (gyan.dev) and installs it locally into `vendor/ffmpeg/`. The program uses the local binary if it exists; otherwise it uses `ffmpeg` from the PATH. To install/update manually: `npm run ffmpeg:install`.

---

### Installation

```powershell
cd streamgrab
npm install
```

> The program itself has **no runtime dependencies** — you can run it directly with `node src/index.js` without `npm install`. `npm install` only installs **ntl** (optional scripts menu) as a dev dependency.

---

### How to run

**Recommended (bypasses CDNs that block non-browser clients, like Mídia Stream):**

```powershell
npm run download:curl
```

Basic (interactive flow):

```powershell
node src/index.js
```

Or use the `streamgrab` binary (available on PATH when installed via npm) with subcommands:

```powershell
streamgrab <url>                      # interactive (compatibility)
streamgrab analyze <url> [--json]     # non-interactive URL analysis
streamgrab download <url> [--output <dir>] [--turbo] [--chunks <n>]  # non-interactive download
streamgrab help                       # subcommand help
```

#### Full usage example

```
==============================================
   StreamGrab — HLS / DASH / YouTube / Social
==============================================

Checking FFmpeg...
FFmpeg OK.

.m3u8 URL: https://example.com/lesson/playlist.m3u8?cP=1997000&access_token=abc&sid=xyz
Recognized URL: https://example.com/lesson/playlist.m3u8?cP=1997000&access_token=***&sid=***

Parsing playlist...

Available qualities:
  1. 1920x1080 (1080p)  ~1.75 Mbps
  2. 1280x720 (720p)  ~0.90 Mbps
  3. 854x480 (480p)  ~0.50 Mbps
  4. 640x360 (360p)  ~0.30 Mbps
  5. 426x240 (240p)  ~0.15 Mbps
  0. Cancel

Choose (Enter = best available): 2
Selected variant: https://example.com/lesson/720p/index.m3u8?access_token=***

File name (without extension): Lesson 01
Output folder (Enter = C:\Users\YourUser\Downloads):
Saving to: C:\Users\YourUser\Downloads\Lesson 01.mp4

Downloading — mode: direct copy (-c copy)
Downloading...  Time: 00:12:43  Size: 184.0 MB  Speed: 6.2x
✅ Download complete!
File saved at: C:\Users\YourUser\Downloads\Lesson 01.mp4
```

#### Command-line arguments

```powershell
node src/index.js --referer "https://example.com/" --origin "https://example.com" --user-agent "Mozilla/5.0 ..."
```

- `--referer <URL>` — sends the `Referer` header
- `--origin <URL>` — sends the `Origin` header
- `--user-agent "<UA>"` — sends the `User-Agent` header
- `--curl-impersonate` / `--ci` — forces curl-impersonate mode
- `--cookies <file>` — uses a `cookies.txt` (Netscape format) for authenticated content (private YouTube, social networks with login)
- `--cookies-from-browser <browser>` — extracts cookies automatically from the browser (`chrome`, `edge`, `firefox`, `brave`, `opera`, `vivaldi`, `chromium`...)
- `--turbo` — parallel chunked download (HTTP Range) on direct URLs (YouTube/social networks/files). Faster: multiple connections at once
- `--chunks <n>` — number of turbo connections (default: 8)
- `--smart-turbo` / `--no-smart-turbo` — enables/disables Smart Turbo (adaptive concurrency)
- `--youtube` — forces the YouTube adapter (used by `npm run download:youtube`)
- `--help` — shows help

The same headers can be set in a `config.json` file in the project folder (see `config.example.json`). Values given on the command line take priority over the file.

---

### Getting a `.m3u8` request URL via DevTools

1. Open the platform and **start playing** the lesson in your browser (Chrome/Edge).
2. Press `F12` to open DevTools.
3. Go to the **Network** tab.
4. In the filter field, type `m3u8` (or `media`).
5. **Play/pause** the video (or reload the page) to generate the requests.
6. Click the request ending in `.m3u8` — it may appear as `index.m3u8`, `master.m3u8`, `playlist.m3u8`, etc.
7. Right-click → **Copy → Copy request URL** and paste it into the program.

> 💡 **Tokens expire fast** (minutes, sometimes seconds). Paste the URL and run the download right away. If the download fails with 403, get a fresh URL.

---

### Master playlist × Variant playlist

| Type | What it contains | Example line |
|---|---|---|
| **Master** | List of variants (resolutions) | `#EXT-X-STREAM-INF:BANDWIDTH=1753000,RESOLUTION=1920x1080` |
| **Variant** | The actual `.ts`/`.m4s` video segments | `#EXTINF:6.000000,` |

- If you paste a **master**, the program lists the found resolutions (1080p, 720p, 480p…) and lets you choose, or picks the **best available** (Enter).
- If you paste a **variant**, the program uses it directly.
- Relative URLs inside the playlist are resolved correctly against the master (`new URL(childUrl, masterUrl)`).

---

### Choosing 1080p

Paste the master `.m3u8` → when the quality list appears, type the number of the `1920x1080` option (or press **Enter** for the best available, which is usually already 1080p).

If the platform doesn't offer 1080p in the list, no option will "create" that resolution — the download uses what's available.

---

### What the 403 error means

The server **refused the request**. The most common causes:

1. **Expired token** — the temporary URL is no longer valid. Get a new request URL from DevTools.
2. **Missing headers** — the server requires browser-like headers (`Referer`, `Origin`, `User-Agent`). Set them in `config.json` or via `--referer`/`--origin`/`--user-agent`.
3. **CDN blocking non-browser clients** — some CDNs (e.g. **mediastre.am / MediastreamCDN**, used by the Mídia Stream platform) use *TLS fingerprinting*: the server detects the request didn't come from a real browser (Chrome/Firefox) and answers `403` even with valid tokens and correct headers. **In that case the download via FFmpeg is refused by the server itself** — but the curl-impersonate mode solves it (see below), as long as you use the **player URL** (with `at=web-app` + the `uid/sid/pid/av` variables from the console), not the raw CDN URL (which gives `403` even in a browser).

The program **does not** try to bypass any of this: without a fresh token or server access, there is no download.

---

### curl-impersonate mode (bypass non-browser client blocking)

For CDNs with *TLS fingerprinting* (item 3 above), the program offers an extra mode that **mimics the TLS of a real browser (Chrome)** when making requests. FFmpeg is only used to **remux files locally** — it never touches the network, so the block doesn't apply.

#### How it works

1. The program detects/uses the **curl-impersonate** binary — **v2.x** format (`curl-impersonate.exe` + `curl_<browser><version>.bat` profiles; the old v1.x format, `curl_chrome*.exe`, is also supported).
2. It downloads the master playlist and the segment playlist with the mimicked TLS (profile `chrome146` by default, with a fallback list).
3. It downloads the **segments** (and AES-128 keys / init segments, if any) in parallel, with retries.
4. It generates a **local playlist** pointing to the downloaded files and FFmpeg remuxes to `.mp4` (with the same mode fallback: `-c copy` → `aac_adtstoasc` → `-c:a aac`).

#### How to enable

- **Automatically:** on `403`, the program asks if you want to try curl-impersonate mode.
- **Forced:** run with `npm run download:curl` (or `node src/index.js --curl-impersonate`, or `--ci`).

#### Installing curl-impersonate (Windows)

1. Go to <https://github.com/lexiforest/curl-impersonate/releases> (original project: <https://github.com/lwthiker/curl-impersonate>) and download the Windows package (e.g. `curl-impersonate-win64.zip`).
2. Extract the ZIP — the **v2.x** format ships `curl-impersonate.exe` + several `curl_chromeNNN.bat` / `curl_edgeNNN.bat` / `curl_firefoxNNN.bat` profiles.
3. Copy the folder to **one** of these options:
   - inside this project, at `streamgrab\tools\`; or
   - add the folder to the Windows PATH.
4. Run again with `npm run download:curl`.

> ⚠️ **Important:** curl-impersonate **does not** bypass DRM (Widevine etc.) and **does not** automate logins or capture cookies — it only makes the TLS connection look like a browser, using the same URL you already have access to. **Check the platform's terms of service** before using, as downloading may not be allowed by it.

---

### mdstrm / MediastreamCDN flow (Mídia Stream platform)

The Mídia Stream player (`mdstrm.com`) protects videos with a **short-lived token (OTE) + session vars** generated when the page loads. **Copying a `.m3u8` URL straight from DevTools gives `403` for everything** (even for a real browser), because the variables (`pid`, `sid`, `uid`, `access_token`) in that URL are tied to the player session and expire/become invalid outside of it.

#### ✅ The program converts automatically

If you paste a CDN URL (`...cdn.mdstrm.com/...`) or a player URL without the variables, the program **detects it by itself** and converts it to the player URL — fetching fresh variables from the public embed page (`mdstrm.com/embed/<videoId>`), no login or cookies needed:

```
[mdstrm] Mídia Stream URL detected (videoId 6a03573096d73ba91827573a).
[mdstrm] Fetching player credentials from the public embed to generate fresh tokens...
[mdstrm] Player URL generated: https://mdstrm.com/video/6a03573096d73ba91827573a.m3u8?at=web-app&uid=***&sid=***&pid=***&av=v7.0.86
```

**Just paste the URL you copied from DevTools and press Enter** — the rest is automatic. Remember to use `--curl-impersonate` (or `npm run download:curl`).

#### Manual (optional, if automatic conversion fails)

1. Open the video page on the platform (e.g. `https://mdstrm.com/embed/<videoId>`) **or** the lesson page on the site.
2. In DevTools, console, read the player variables: `MDSTRMUID`, `MDSTRMSID`, `MDSTRMPID`, `VERSION` (e.g. `v7.0.86`).
3. Build the player URL:

   ```
   https://mdstrm.com/video/<videoId>.m3u8?at=web-app&uid=<MDSTRMUID>&sid=<MDSTRMSID>&pid=<MDSTRMPID>&av=<VERSION>
   ```

4. Paste **that** URL into the program (with `--curl-impersonate`). The server responds with the master playlist containing **fresh tokens** per variant; the program downloads everything and remuxes to `.mp4`.

> 💡 The generated tokens last a few hours; if you get `403` halfway through, the program re-does the conversion on the next run.
> 🔒 **Honest limitation:** DRM (Widevine/PlayReady) is not bypassed — this only works with regular HLS streaming videos.

---

### Where the video is saved

- By default, in the Windows user **Downloads** folder (obtained programmatically via `os.homedir()` — no username is hardcoded).
- You can type another folder in the prompt; if it doesn't exist, the program creates it.
- The file name is **sanitized** (invalid Windows characters like `< > : " / \ | ? *` are replaced) and the `.mp4` extension is added automatically.
- If the file already exists, the program asks: **O**verwrite / **N**ew name / **C**ancel.

---

### MP4 quality and compatibility

1. First attempt: `-c copy` — **no re-encoding**, no quality loss (direct remux).
2. If the MP4 has audio incompatibility, it tries `-c copy -bsf:a aac_adtstoasc` (container fix, still no re-encoding).
3. Last resort: `-c:v copy -c:a aac` (re-encodes only the audio to AAC, preserving the video).

Audio conversion is only used **when necessary**.

---

### ⚡ Turbo mode (faster downloads)

By default the download uses **1 connection** (FFmpeg) — the speed limit is per-connection on the server. **Turbo** splits the file into parts and downloads **multiple parallel connections** (IDM/aria2 style), bypassing that limit:

```powershell
node src/index.js --turbo                 # 8 parallel connections (default)
node src/index.js --turbo --chunks 16     # 16 connections
```

Works on **direct URLs**: YouTube (progressive and adaptive — video+audio download **at the same time**), social networks and `.mp4`/`.webm` files. Does not apply to HLS (`.m3u8`) or DASH (`.mpd`).

- If the server **doesn't support** ranged downloads (no `Accept-Ranges`), turbo detects it and **falls back automatically** to the normal flow — no error.
- Can also be enabled by default in `config.json`: `{ "turbo": true, "turboChunks": 8 }`.
- In **Electron**, it's a "⚡ Turbo" checkbox in each tab.

### 🧠 Smart Turbo (adaptive concurrency)

**Smart Turbo** adjusts the number of connections **during** the download, guided by a benchmark (`tests/performance/BASELINE.md`): it ramps up (2→4→8→12) while the per-connection throughput holds, and **backs off** on throttling (drop > 30% of per-connection with stalled total) or 429/5xx errors — without inducing server blocks. On fast links it finds the ceiling of your connection; on limited servers it stops wasting connections.

```powershell
node src/index.js --turbo --chunks 12            # fixed pool (previous behavior)
node src/index.js --turbo --smart-turbo          # adaptive (max 12)
node src/index.js --turbo --no-smart-turbo       # explicit rollback via CLI
```

- Default: **off** (fixed pool). `--no-smart-turbo` disables even with config active (rollback).
- Typical gain: **2–10x** on fast connections (the ceiling becomes your link, not the per-connection throttling).

### 🎬 YouTube downloads (best resolution)

```powershell
npm run download:youtube
```

Paste a YouTube video URL (`https://www.youtube.com/watch?v=...` or `https://youtu.be/...`). The program lists the **available qualities** (2160p/1440p/1080p/720p/...) and downloads the chosen one at the **best available resolution** — for 4K videos it downloads the video and the best audio separately and **merges them with FFmpeg** (`-c copy`, lossless).

> ℹ️ YouTube resolution is resolved by **yt-dlp** (standalone binary, downloaded automatically on install via the `youtube-dl-exec` package — no Python needed). yt-dlp keeps the signature deciphering logic, the `n` parameter transform, proof-of-origin tokens (POT) and the new YouTube SABR streaming up to date. The generated links are downloaded by the local FFmpeg with the same fallback modes as the rest of the program.

### 🔐 Private / authenticated content (login)

Yes, you can download **private** videos (e.g. "unlisted"/private YouTube, restricted Facebook/Instagram posts) **as long as you have authenticated access** — the program uses the cookies from your session:

1. **Export the cookies** from your browser while logged in:
   - Install the **"Get cookies.txt LOCALLY"** extension (Chrome/Edge/Firefox)
   - Open the video page, click the extension and export the `cookies.txt`
2. **Use the file** (must be in the project folder):

   ```powershell
   node src/index.js --cookies cookies.txt
   ```

3. **Or extract straight from the browser** (no export needed):

   ```powershell
   node src/index.js --cookies-from-browser chrome
   ```

> ⚠️ **Limitations:** (1) content protected by **DRM** (Widevine/PlayReady, common on streaming services) remains unsupported; (2) accounts with **2FA** sometimes require browser extraction instead of cookies.txt; (3) only use content you have the right to access.

---

### Token security

- Sensitive URL parameters (`token`, `access_token`, `authorization`, `auth`, `sid`, `uid`, `signature`, `sig`, `key`, etc.) have their values **masked** (`***`) in every display.
- The full URL is **never** written to logs. The `downloads.log` (created in the project folder) only records date, file name, quality used, and the **masked** URL.
- What you paste into the prompt goes straight to Node (raw terminal mode) — PowerShell doesn't interpret `&`, `?`, `=`, `%` from the URL, so **paste without worrying about escaping**. Don't build FFmpeg commands manually in PowerShell.
- **URL from clipboard:** if you press empty `Enter` at the ".m3u8 URL" prompt, the program automatically reads the copied URL from the clipboard (Windows). Useful when pasting doesn't work (e.g. running via `ntl`).

---

### Interrupting with Ctrl+C

Press `Ctrl+C` at any time:

- **During the prompt**: exits the program.
- **During the download**: sends the stop command to FFmpeg (graceful shutdown, the file is closed correctly) and, if needed, force-kills after a few seconds. **No orphan processes left behind.** Partial files are removed.

---

### Project structure

```
streamgrab/
  package.json
  config.example.json
  README.md
  bin/
    streamgrab.mjs       # CLI entry point (`streamgrab` on PATH via npm)
  tools/                # curl-impersonate (v2.x) — used by --curl-impersonate mode
  vendor/ffmpeg/        # local FFmpeg (downloaded automatically by npm install)
  electron/             # graphical interface (queue, history, settings)
    main.js             # main process (queue/history/settings IPC)
    preload.cjs         # secure bridge (contextBridge) to the renderer
    renderer.js         # UI: Videos / Queue / History / Settings
    services.js         # Core + Engine + Queue + Settings + History (pure Node)
    security.js         # IPC payload validation
    index.html / styles.css
  scripts/
    install-ffmpeg.mjs  # downloads/installs FFmpeg into vendor/ffmpeg/ (postinstall)
    install-electron.mjs# validates the Electron install (postinstall)
    package-resources.mjs # bundles FFmpeg/yt-dlp/curl-impersonate into the installer
    update-ytdlp.mjs    # updates the yt-dlp binary
  tests/
    unit/               # unit tests (node:test)
    integration/        # integration tests (local servers + FFmpeg)
    e2e/                # E2E suite: generates local HLS (AES-128/fMP4), direct MP4, DASH and mdstrm
    performance/        # performance baselines (BASELINE.md)
  src/
    index.js              # CLI entry (analyze/download/interactive dispatch)
    cli-flow.js           # CLI session orchestration
    cli/                  # CLI flow modules
      commands.js         # analyze/download/help subcommands
      context.js          # context, MODE_LABELS, Ctrl+C interruption
      ui.js               # printing, variant selection, file name
      progress.js         # progress bar (CLI and Electron)
      config.js           # config.json, headers, turbo/smart-turbo
      download.js         # FFmpeg flows (direct and video+audio mux)
      curl-flow.js        # curl-impersonate flow (HLS segments)
      turbo.js            # parallel chunked download (HTTP Range)
    core/                 # core shared by CLI + Electron (P2–P11)
      index.js            # public API (StreamGrabCore facade)
      engine.js           # DownloadEngine (states, events, disk, atomic)
      queue.js            # persisted download queue (pause/resume/cancel/retry)
      settings.js         # persisted settings (settings.json)
      history.js          # persisted history (history.json)
      storage.js          # atomic JSON writes
      atomic.js           # atomic .part → rename writes
      disk.js             # free disk space check
      filenames.js        # safe file names
      retry.js            # backoff / Retry-After
      strategy.js         # transport selection and fallback
      resources.js        # semaphore / resource limits
      resume.js           # download resume (ETag/Last-Modified)
      session.js          # expired-URL re-analysis
      smart-turbo.js      # adaptive concurrency
      models.js / errors.js / events.js / logger.js / binaries.js
    providers/            # source providers (analysis + download)
      registry.js         # ProviderRegistry (URL-type discovery)
      hls/                # HLS (.m3u8) — parsing, DRM (no bypass)
      dash/               # DASH (.mpd)
      direct/             # direct files (mp4/webm/mkv...)
      ytdlp/              # yt-dlp (YouTube, social networks, any supported site)
    transports/           # network transports
      http.js / curl.js / range.js / ytdlp-runner.js
    adapters/             # thin source adapters (ytdlp/youtube/social)
    source-adapters.js    # URL → adapter routing
    legacy/               # old YouTube engine (SABR) — E2E only
    ffmpeg.js / hls.js / dash.js / curlimp.js / mdstrm.js / input.js / utils.js
```

### Tests

```powershell
npm test                 # unit + integration + E2E
npm run test:unit        # unit tests only
npm run test:integration # integration tests only (local servers + FFmpeg)
npm run test:e2e         # full E2E suite
npm run lint             # ESLint
```

The E2E suite (`tests/e2e/curl-e2e.mjs`) generates real local HLS playlists with FFmpeg (AES-128 encrypted MPEG-TS and fMP4 with EXT-X-MAP), starts a local HTTP server, and validates the full curl-impersonate flow — including v2.x detection and Mídia Stream URL conversion. The integration tests cover the core (facade + engine), the Electron queue/history/settings (`tests/integration/electron-queue.test.js`), turbo, mux, retry and yt-dlp. The real `tools/` is preserved (automatic backup/restore).

### Interactive menu (optional, via ntl)

To avoid typing commands, install [ntl](https://www.npmjs.com/package/ntl) (npm scripts menu):

```powershell
npm install --save-dev ntl
npx ntl        # opens the menu; choose download:curl
nt             # re-runs the last chosen script
```

### 🖥 Electron interface (queue, history and settings)

Besides the CLI, the app can be opened as a graphical interface (`npm run electron:dev` or `npm run electron:serve`) with:

- **Videos** — tabs with URL analysis, quality/variant selection, destination folder and **"Download now"**;
- **Queue** — real downloads with **limited concurrency** (1–16 simultaneous), states *waiting/downloading/paused*, **pause/resume/cancel/retry/remove** per item and global queue pause;
- **History** — persisted records of every download with **open file / show in folder / download again / remove / clear**;
- **Settings** — default folder, concurrent downloads, turbo, default quality, audio, theme, notifications, command on complete and history retention;
- Queue, history and settings are **persisted to disk** (`settings.json`, `history.json`, `queue.json`) and restored on restart — including **interrupted-download recovery** (jobs come back to the queue as *waiting*).

### Building (Windows installer)

The **StreamGrab-Setup-<version>.exe** installer (NSIS) is produced with **electron-builder**. External binaries (FFmpeg from `vendor/ffmpeg/` — **including the shared-build DLLs**, yt-dlp from the `youtube-dl-exec` package and, if present, curl-impersonate from `tools/`) are bundled into `extraResources` (`resources/bin/`) — in production the app resolves binaries via `process.resourcesPath`, so the **target machine does not need** Node.js, FFmpeg or yt-dlp installed manually.

```powershell
npm run pack:resources   # copies binaries into build/extraResources/bin
npm run dist             # produces dist/StreamGrab-Setup-<version>.exe (Windows)
npm run dist:dir         # unpacked build (dist/win-unpacked) — for testing
npm run release          # dist + SHA-256 checksums (dist/SHA256SUMS.txt)
npm run update:ytdlp     # updates the yt-dlp binary (all local copies)
```

> Requires `npm install` first (the `postinstall` downloads FFmpeg/Electron/yt-dlp). PR CI: `.github/workflows/ci.yml` (lint + tests + build). Manual release: push a `v*` tag — `.github/workflows/release.yml` builds the installer, checksums and publishes the GitHub Release.

### Limitations (by design)

- Doesn't work with DRM-protected videos (Widevine/PlayReady) or encrypted content.
- Doesn't automate logins or capture cookies.
- Doesn't discover or fabricate tokens.
- Only works with URLs you provide and to which you already have authorized access.

Use only for content you have the right to download.

---

<h2 id="es">🇪🇸 Español</h2>

Una **aplicación CLI en Node.js** (con interfaz **Electron** opcional) para descargar videos de **HLS (.m3u8)**, **DASH (.mpd)**, **YouTube**, **redes sociales**, **archivos directos** y **otras fuentes compatibles** (cualquier sitio cubierto por el motor yt-dlp) usando **FFmpeg**, de forma sencilla y segura en Windows. Soporta Mídia Stream (mdstrm) vía curl-impersonate, descarga paralela (turbo) en URLs directas y mux de video+audio para máxima calidad.

> ⚠️ **Uso responsable**
> Esta herramienta funciona **solamente** con URLs que tú mismo proporcionas y a las que ya tienes **acceso legítimo y autorizado** por la plataforma. **No** hace bypass de DRM (Widevine, etc.), no evade la autenticación, no captura cookies del navegador, no descubre credenciales y no intenta acceder a nada más allá de lo que la URL proporcionada ya permite.

---

### Requisitos

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **Windows 10/11** (también funciona en macOS/Linux, pero la instalación automática de FFmpeg es solo en Windows)
- **FFmpeg** — se descarga **automáticamente** con `npm install` (en `vendor/ffmpeg/`). Alternativamente, instálalo manualmente y agrégalo al PATH.

> 💡 `npm install` ejecuta un script (`postinstall`) que descarga el build *essentials* de FFmpeg (gyan.dev) y lo instala localmente en `vendor/ffmpeg/`. El programa usa el binario local si existe; si no, usa `ffmpeg` del PATH. Para instalar/actualizar manualmente: `npm run ffmpeg:install`.

---

### Instalación

```powershell
cd streamgrab
npm install
```

> El programa en sí **no usa dependencias de runtime** — puedes ejecutarlo directamente con `node src/index.js` sin `npm install`. `npm install` solo instala **ntl** (menú opcional de scripts) como dependencia de desarrollo.

---

### Cómo ejecutar

**Recomendado (sortea CDNs que bloquean clientes que no son navegador, como Mídia Stream):**

```powershell
npm run download:curl
```

Básico (flujo interactivo):

```powershell
node src/index.js
```

O usa el binario `streamgrab` (disponible en el PATH cuando se instala vía npm) con subcomandos:

```powershell
streamgrab <url>                      # interactivo (compatibilidad)
streamgrab analyze <url> [--json]     # análisis no interactivo de la URL
streamgrab download <url> [--output <dir>] [--turbo] [--chunks <n>]  # descarga no interactiva
streamgrab help                       # ayuda de subcomandos
```

#### Ejemplo de uso completo

```
==============================================
   StreamGrab — HLS / DASH / YouTube / Social
==============================================

Verificando FFmpeg...
FFmpeg OK.

URL del .m3u8: https://ejemplo.com/leccion/playlist.m3u8?cP=1997000&access_token=abc&sid=xyz
URL reconocida: https://ejemplo.com/leccion/playlist.m3u8?cP=1997000&access_token=***&sid=***

Analizando playlist...

Calidades encontradas:
  1. 1920x1080 (1080p)  ~1.75 Mbps
  2. 1280x720 (720p)  ~0.90 Mbps
  3. 854x480 (480p)  ~0.50 Mbps
  4. 640x360 (360p)  ~0.30 Mbps
  5. 426x240 (240p)  ~0.15 Mbps
  0. Cancelar

Elige (Enter = mejor disponible): 2
Variant elegida: https://ejemplo.com/leccion/720p/index.m3u8?access_token=***

Nombre del archivo (sin extensión): Lección 01
Carpeta de salida (Enter = C:\Users\TuUsuario\Downloads):
Guardando en: C:\Users\TuUsuario\Downloads\Lección 01.mp4

Descargando — modo: copia directa (-c copy)
Descargando...  Tiempo: 00:12:43  Tamaño: 184.0 MB  Velocidad: 6.2x
✅ ¡Descarga completada!
Archivo guardado en: C:\Users\TuUsuario\Downloads\Lección 01.mp4
```

#### Argumentos de línea de comandos

```powershell
node src/index.js --referer "https://ejemplo.com/" --origin "https://ejemplo.com" --user-agent "Mozilla/5.0 ..."
```

- `--referer <URL>` — envía el header `Referer`
- `--origin <URL>` — envía el header `Origin`
- `--user-agent "<UA>"` — envía el header `User-Agent`
- `--curl-impersonate` / `--ci` — fuerza el modo curl-impersonate
- `--cookies <archivo>` — usa un `cookies.txt` (formato Netscape) para contenido autenticado (YouTube privado, redes sociales con login)
- `--cookies-from-browser <navegador>` — extrae cookies automáticamente del navegador (`chrome`, `edge`, `firefox`, `brave`, `opera`, `vivaldi`, `chromium`...)
- `--turbo` — descarga paralela por partes (HTTP Range) en URLs directas (YouTube/redes sociales/archivos). Más rápido: varias conexiones a la vez
- `--chunks <n>` — número de conexiones del modo turbo (predeterminado: 8)
- `--smart-turbo` / `--no-smart-turbo` — activa/desactiva Smart Turbo (concurrencia adaptativa)
- `--youtube` — fuerza el adaptador de YouTube (usado por `npm run download:youtube`)
- `--help` — muestra la ayuda

Los mismos headers se pueden definir en un archivo `config.json` en la carpeta del proyecto (ver `config.example.json`). Los valores dados en la línea de comandos tienen prioridad sobre el archivo.

---

### Cómo obtener una URL de solicitud `.m3u8` con DevTools

1. Accede a la plataforma e **inicia la reproducción** de la lección en el navegador (Chrome/Edge).
2. Pulsa `F12` para abrir DevTools.
3. Ve a la pestaña **Network** (Red).
4. En el campo de filtro, escribe `m3u8` (o `media`).
5. Haz **play/pause** en el video (o recarga la página) para generar las solicitudes.
6. Haz clic en la solicitud que termina en `.m3u8` — puede aparecer como `index.m3u8`, `master.m3u8`, `playlist.m3u8`, etc.
7. Clic derecho → **Copy → Copy request URL** y pégala en el programa.

> 💡 **Los tokens expiran rápido** (minutos, a veces segundos). Pega la URL y ejecuta la descarga enseguida. Si la descarga falla con 403, obtén una URL nueva.

---

### Master playlist × Variant playlist

| Tipo | Qué contiene | Ejemplo de línea |
|---|---|---|
| **Master** | Lista de variantes (resoluciones) | `#EXT-X-STREAM-INF:BANDWIDTH=1753000,RESOLUTION=1920x1080` |
| **Variant** | Los segmentos `.ts`/`.m4s` del video | `#EXTINF:6.000000,` |

- Si pegas una **master**, el programa lista las resoluciones encontradas (1080p, 720p, 480p…) y te deja elegir, o elige la **mejor disponible** (Enter).
- Si pegas una **variant**, el programa la usa directamente.
- Las URLs relativas dentro de la playlist se resuelven correctamente contra la master (`new URL(childUrl, masterUrl)`).

---

### Cómo elegir 1080p

Pega la master `.m3u8` → cuando aparezca la lista de calidades, escribe el número de la opción `1920x1080` (o pulsa **Enter** para la mejor disponible, que normalmente ya es 1080p).

Si la plataforma no ofrece 1080p en la lista, ninguna opción va a "crear" esa resolución — la descarga usa lo que está disponible.

---

### Qué significa el error 403

El servidor **rechazó la solicitud**. Las causas más comunes:

1. **Token expirado** — la URL temporal dejó de ser válida. Obtén una nueva URL de solicitud en DevTools.
2. **Headers faltantes** — el servidor exige headers iguales a los del navegador (`Referer`, `Origin`, `User-Agent`). Configúralos en `config.json` o con los argumentos `--referer`/`--origin`/`--user-agent`.
3. **CDN que bloquea clientes que no son navegador** — algunos CDNs (ej.: **mediastre.am / MediastreamCDN**, usado por la plataforma Mídia Stream) usan *fingerprinting TLS*: el servidor detecta que la solicitud no vino de un navegador real (Chrome/Firefox) y responde `403` incluso con tokens válidos y headers correctos. **En ese caso la descarga vía FFmpeg es rechazada por el propio servidor** — pero el modo curl-impersonate lo resuelve (ver abajo), siempre que uses la **URL del player** (con `at=web-app` + las variables `uid/sid/pid/av` de la consola), no la URL cruda del CDN (que da `403` incluso en el navegador).

El programa **no** intenta evadir nada de esto: sin token nuevo o sin acceso del servidor, no hay descarga.

---

### Modo curl-impersonate (sortear el bloqueo de clientes que no son navegador)

Para CDNs con *fingerprinting TLS* (ítem 3 de arriba), el programa ofrece un modo extra que **imita el TLS de un navegador real (Chrome)** al hacer las solicitudes. FFmpeg solo entra para **remuxar los archivos localmente** — nunca toca la red, así que el bloqueo no aplica.

#### Cómo funciona

1. El programa detecta/usa el binario **curl-impersonate** — formato **v2.x** (`curl-impersonate.exe` + perfiles `curl_<navegador><versión>.bat`; el formato antiguo v1.x, `curl_chrome*.exe`, también es compatible).
2. Descarga la master playlist y la playlist de segmentos con el TLS imitado (perfil `chrome146` por defecto, con lista de fallback).
3. Descarga los **segmentos** (y claves AES-128 / init segments, si los hay) en paralelo, con reintentos.
4. Genera una **playlist local** apuntando a los archivos descargados y FFmpeg hace el remux a `.mp4` (con el mismo fallback de modos: `-c copy` → `aac_adtstoasc` → `-c:a aac`).

#### Cómo activarlo

- **Automáticamente:** al recibir `403`, el programa pregunta si quieres probar el modo curl-impersonate.
- **Forzado:** ejecuta con `npm run download:curl` (o `node src/index.js --curl-impersonate`, o `--ci`).

#### Instalación de curl-impersonate (Windows)

1. Ve a <https://github.com/lexiforest/curl-impersonate/releases> (proyecto original: <https://github.com/lwthiker/curl-impersonate>) y descarga el paquete para Windows (ej.: `curl-impersonate-win64.zip`).
2. Extrae el ZIP — el formato **v2.x** trae `curl-impersonate.exe` + varios `curl_chromeNNN.bat` / `curl_edgeNNN.bat` / `curl_firefoxNNN.bat`.
3. Copia la carpeta a **una** de estas opciones:
   - dentro de este proyecto, en `streamgrab\tools\`; o
   - agrega la carpeta al PATH de Windows.
4. Ejecuta de nuevo con `npm run download:curl`.

> ⚠️ **Importante:** curl-impersonate **no** evita DRM (Widevine, etc.) y **no** automatiza inicios de sesión ni captura cookies — solo hace que la conexión TLS parezca un navegador, usando la misma URL a la que ya tienes acceso. **Revisa los términos de uso de la plataforma** antes de usarlo, ya que la descarga puede no estar permitida por ella.

---

### Flujo mdstrm / MediastreamCDN (plataforma Mídia Stream)

El player de Mídia Stream (`mdstrm.com`) protege los videos con un **token corto (OTE) + variables de sesión** que se generan cuando carga la página. **Copiar una URL `.m3u8` directo de DevTools da `403` para todo** (incluso para un navegador real), porque las variables (`pid`, `sid`, `uid`, `access_token`) de esa URL están amarradas a la sesión del player y expiran/quedan inválidas fuera de ella.

#### ✅ El programa convierte automáticamente

Si pegas una URL del CDN (`...cdn.mdstrm.com/...`) o una URL del player sin las variables, el programa **lo detecta solo** y la convierte a la URL del player — buscando las variables frescas en la página pública del embed (`mdstrm.com/embed/<videoId>`), sin login ni cookies:

```
[mdstrm] URL de Mídia Stream detectada (videoId 6a03573096d73ba91827573a).
[mdstrm] Buscando credenciales del player en el embed público para generar tokens frescos...
[mdstrm] URL del player generada: https://mdstrm.com/video/6a03573096d73ba91827573a.m3u8?at=web-app&uid=***&sid=***&pid=***&av=v7.0.86
```

**Solo pega la URL que copiaste de DevTools y pulsa Enter** — el resto es automático. Recuerda usar `--curl-impersonate` (o `npm run download:curl`).

#### Manual (opcional, si la conversión automática falla)

1. Abre la página del video en la plataforma (ej.: `https://mdstrm.com/embed/<videoId>`) **o** la página de la lección en el sitio.
2. En DevTools, consola, lee las variables del player: `MDSTRMUID`, `MDSTRMSID`, `MDSTRMPID`, `VERSION` (ej.: `v7.0.86`).
3. Arma la URL del player:

   ```
   https://mdstrm.com/video/<videoId>.m3u8?at=web-app&uid=<MDSTRMUID>&sid=<MDSTRMSID>&pid=<MDSTRMPID>&av=<VERSION>
   ```

4. Pega **esa** URL en el programa (con `--curl-impersonate`). El servidor responde con la master playlist que contiene **tokens frescos** por variante; el programa descarga todo y remuxa a `.mp4`.

> 💡 Los tokens generados duran algunas horas; si te da `403` a mitad, el propio programa rehace la conversión en la siguiente ejecución.
> 🔒 **Límite honesto:** el DRM (Widevine/PlayReady) no se evita — esto solo funciona con videos de streaming HLS común.

---

### Dónde se guarda el video

- Por defecto, en la carpeta **Downloads** del usuario de Windows (obtenida programáticamente vía `os.homedir()` — ningún nombre de usuario está fijo en el código).
- Puedes escribir otra carpeta en el prompt; si no existe, el programa la crea.
- El nombre del archivo se **sanitiza** (caracteres inválidos de Windows como `< > : " / \ | ? *` se reemplazan) y se agrega la extensión `.mp4` automáticamente.
- Si el archivo ya existe, el programa pregunta: **S**obrescribir / **N**uevo nombre / **C**ancelar.

---

### Calidad y compatibilidad del MP4

1. Primer intento: `-c copy` — **sin recodificación**, sin pérdida de calidad (remux directo).
2. Si el MP4 presenta incompatibilidad de audio, intenta `-c copy -bsf:a aac_adtstoasc` (corrección de contenedor, aún sin recodificar).
3. Por último, intenta `-c:v copy -c:a aac` (reconvierte solo el audio a AAC, preservando el video).

La conversión de audio solo se usa **cuando es necesario**.

---

### ⚡ Modo turbo (descargas más rápidas)

Por defecto la descarga usa **1 conexión** (FFmpeg) — el límite de velocidad está en el servidor por conexión. El **turbo** divide el archivo en partes y descarga **varias conexiones en paralelo** (estilo IDM/aria2), sorteando ese límite:

```powershell
node src/index.js --turbo                 # 8 conexiones paralelas (predeterminado)
node src/index.js --turbo --chunks 16     # 16 conexiones
```

Funciona en **URLs directas**: YouTube (progresivo y adaptativo — video+audio se descargan **al mismo tiempo**), redes sociales y archivos `.mp4`/`.webm`. No aplica a HLS (`.m3u8`) ni DASH (`.mpd`).

- Si el servidor **no soporta** descarga por partes (sin `Accept-Ranges`), el turbo lo detecta y **vuelve automáticamente** al flujo normal — sin error.
- También se puede activar por defecto en `config.json`: `{ "turbo": true, "turboChunks": 8 }`.
- En **Electron**, es una casilla "⚡ Turbo" en cada pestaña.

### 🧠 Smart Turbo (concurrencia adaptativa)

El **Smart Turbo** ajusta el número de conexiones **durante** la descarga, guiado por un benchmark (`tests/performance/BASELINE.md`): sube en rampa (2→4→8→12) mientras el throughput por conexión se mantiene, y **reduce con backoff** al detectar throttling (caída > 30% del por-conexión con total estancado) o errores 429/5xx — sin inducir bloqueos en el servidor. En enlaces rápidos encuentra el techo de tu conexión; en servidores limitados, deja de desperdiciar conexiones.

```powershell
node src/index.js --turbo --chunks 12            # pool fijo (comportamiento anterior)
node src/index.js --turbo --smart-turbo          # adaptativo (max 12)
node src/index.js --turbo --no-smart-turbo       # rollback explícito por CLI
```

- Predeterminado: **apagado** (pool fijo). `--no-smart-turbo` apaga incluso con config activa (rollback).
- Ganancia típica: **2–10x** en conexiones rápidas (el techo pasa a ser tu enlace, no el throttling por conexión del servidor).

### 🎬 Descarga de YouTube (mejor resolución)

```powershell
npm run download:youtube
```

Pega una URL de video de YouTube (`https://www.youtube.com/watch?v=...` o `https://youtu.be/...`). El programa lista las **calidades encontradas** (2160p/1440p/1080p/720p/...) y descarga la elegida en la **mejor resolución disponible** — para videos 4K descarga el video y el mejor audio por separado y **los une con FFmpeg** (`-c copy`, sin pérdida de calidad).

> ℹ️ La resolución de YouTube la resuelve **yt-dlp** (binario standalone, descargado automáticamente en la instalación vía el paquete `youtube-dl-exec` — sin Python). yt-dlp mantiene actualizada la lógica de descifrado de firmas, la transformación del parámetro `n`, los tokens de prueba de origen (POT) y el nuevo streaming SABR de YouTube. Los enlaces generados los descarga el FFmpeg local, con los mismos modos de fallback que el resto del programa.

### 🔐 Contenido privado / autenticado (login)

Sí, puedes descargar videos **privados** (ej.: "no listado"/privado en YouTube, post restringido en Facebook/Instagram) **siempre que tengas acceso autenticado** — el programa usa las cookies de tu sesión:

1. **Exporta las cookies** del navegador mientras estés logueado:
   - Instala la extensión **"Get cookies.txt LOCALLY"** (Chrome/Edge/Firefox)
   - Abre la página del video, haz clic en la extensión y exporta el `cookies.txt`
2. **Usa el archivo** (debe estar en la carpeta del proyecto):

   ```powershell
   node src/index.js --cookies cookies.txt
   ```

3. **O extrae directo del navegador** (sin exportar nada):

   ```powershell
   node src/index.js --cookies-from-browser chrome
   ```

> ⚠️ **Limitaciones:** (1) el contenido protegido por **DRM** (Widevine/PlayReady, común en servicios de streaming) sigue sin soporte; (2) las cuentas con **2FA** a veces requieren extracción del navegador en lugar de cookies.txt; (3) usa solo contenido al que tienes derecho de acceso.

---

### Seguridad de los tokens

- Los parámetros sensibles de la URL (`token`, `access_token`, `authorization`, `auth`, `sid`, `uid`, `signature`, `sig`, `key`, etc.) tienen sus valores **enmascarados** (`***`) en toda exhibición.
- La URL completa **nunca** se registra en logs. El `downloads.log` (generado en la carpeta del proyecto) registra solo fecha, nombre del archivo, calidad usada y la URL **enmascarada**.
- Lo que pegas en el prompt va directo a Node (modo raw del terminal) — PowerShell no interpreta `&`, `?`, `=`, `%` de la URL, así que **pega sin preocuparte por el escaping**. No armes comandos FFmpeg manualmente en PowerShell.
- **URL desde el portapapeles:** si pulsas `Enter` vacío en el prompt "URL del .m3u8", el programa lee automáticamente la URL copiada del portapapeles (Windows). Útil cuando pegar no funciona (ej.: ejecutando vía `ntl`).

---

### Interrumpir con Ctrl+C

Pulsa `Ctrl+C` en cualquier momento:

- **Durante el prompt**: cierra el programa.
- **Durante la descarga**: envía el comando de detención a FFmpeg (apagado elegante, el archivo se cierra correctamente) y, si es necesario, fuerza el cierre tras unos segundos. **No quedan procesos huérfanos.** Los archivos parciales se eliminan.

---

### Estructura del proyecto

```
streamgrab/
  package.json
  config.example.json
  README.md
  bin/
    streamgrab.mjs       # entry point de la CLI (`streamgrab` en el PATH vía npm)
  tools/                # curl-impersonate (v2.x) — usado por el modo --curl-impersonate
  vendor/ffmpeg/        # FFmpeg local (descargado automáticamente por npm install)
  electron/             # interfaz gráfica (cola, historial, configuración)
    main.js             # proceso principal (IPC cola/historial/configuración)
    preload.cjs         # puente seguro (contextBridge) al renderer
    renderer.js         # UI: Videos / Cola / Historial / Configuración
    services.js         # Core + Engine + Queue + Settings + History (Node puro)
    security.js         # validación de payloads de los canales IPC
    index.html / styles.css
  scripts/
    install-ffmpeg.mjs  # descarga/instala FFmpeg en vendor/ffmpeg/ (postinstall)
    install-electron.mjs# valida la instalación de Electron (postinstall)
    package-resources.mjs # empaqueta FFmpeg/yt-dlp/curl-impersonate en el instalador
    update-ytdlp.mjs    # actualiza el binario de yt-dlp
  tests/
    unit/               # pruebas unitarias (node:test)
    integration/        # pruebas de integración (servidores locales + FFmpeg)
    e2e/                # suite E2E: genera HLS local (AES-128/fMP4), MP4 directo, DASH y mdstrm
    performance/        # baselines de rendimiento (BASELINE.md)
  src/
    index.js              # entry de la CLI (dispatch analyze/download/interactivo)
    cli-flow.js           # orquestación de la sesión CLI
    cli/                  # módulos del flujo CLI
      commands.js         # subcomandos analyze/download/help
      context.js          # contexto, MODE_LABELS, interrupción (Ctrl+C)
      ui.js               # impresiones, selección de variante, nombre de archivo
      progress.js         # barra de progreso (CLI y Electron)
      config.js           # config.json, headers, turbo/smart-turbo
      download.js         # flujos FFmpeg (directo y mux de video+audio)
      curl-flow.js        # flujo curl-impersonate (segmentos HLS)
      turbo.js            # descarga paralela por partes (HTTP Range)
    core/                 # núcleo compartido CLI + Electron (P2–P11)
      index.js            # API pública (fachada StreamGrabCore)
      engine.js           # DownloadEngine (estados, eventos, disco, atómico)
      queue.js            # cola de descargas persistida (pause/resume/cancel/retry)
      settings.js         # configuración persistida (settings.json)
      history.js          # historial persistido (history.json)
      storage.js          # escritura atómica JSON
      atomic.js           # escritura atómica .part → rename
      disk.js             # verificación de espacio en disco
      filenames.js        # nombres seguros de archivo
      retry.js            # backoff / Retry-After
      strategy.js         # selección de transporte y fallback
      resources.js        # semáforo / límite de recursos
      resume.js           # reanudación de descarga (ETag/Last-Modified)
      session.js          # reanálisis de URL expirada
      smart-turbo.js      # concurrencia adaptativa
      models.js / errors.js / events.js / logger.js / binaries.js
    providers/            # proveedores de fuente (análisis + descarga)
      registry.js         # ProviderRegistry (descubrimiento por tipo de URL)
      hls/                # HLS (.m3u8) — parsing, DRM (sin bypass)
      dash/               # DASH (.mpd)
      direct/             # archivos directos (mp4/webm/mkv...)
      ytdlp/              # yt-dlp (YouTube, redes sociales, cualquier sitio compatible)
    transports/           # transportes de red
      http.js / curl.js / range.js / ytdlp-runner.js
    adapters/             # adaptadores finos de fuente (ytdlp/youtube/social)
    source-adapters.js    # ruteo URL → adaptador
    legacy/               # motor antiguo de YouTube (SABR) — solo E2E
    ffmpeg.js / hls.js / dash.js / curlimp.js / mdstrm.js / input.js / utils.js
```

### Tests

```powershell
npm test                 # unit + integration + E2E
npm run test:unit        # solo pruebas unitarias
npm run test:integration # solo pruebas de integración (servidores locales + FFmpeg)
npm run test:e2e         # suite E2E completa
npm run lint             # ESLint
```

La suite E2E (`tests/e2e/curl-e2e.mjs`) genera playlists HLS locales reales con FFmpeg (MPEG-TS cifrado con AES-128 y fMP4 con EXT-X-MAP), levanta un servidor HTTP local y valida el flujo completo del modo curl-impersonate — incluyendo la detección v2.x y la conversión de URLs de Mídia Stream. Las pruebas de integración cubren el núcleo (facade + engine), la cola/historial/configuración de Electron (`tests/integration/electron-queue.test.js`), turbo, mux, retry y yt-dlp. El `tools/` real se preserva (backup/restauración automática).

### Menú interactivo (opcional, vía ntl)

Para no teclear comandos, instala [ntl](https://www.npmjs.com/package/ntl) (menú de scripts de npm):

```powershell
npm install --save-dev ntl
npx ntl        # abre el menú; elige download:curl
nt             # reejecuta el último script elegido
```

### 🖥 Interfaz Electron (cola, historial y configuración)

Además del CLI, la app se puede abrir como interfaz gráfica (`npm run electron:dev` o `npm run electron:serve`) con:

- **Videos** — pestañas con análisis de URL, selección de calidad/variante, carpeta de destino y **"Descargar ahora"**;
- **Cola** — descargas reales con **concurrencia limitada** (1–16 simultáneas), estados *esperando/descargando/pausado*, **pause/resume/cancelar/reintentar/eliminar** por elemento y pausa global de la cola;
- **Historial** — registros persistidos de cada descarga con **abrir archivo / mostrar en carpeta / descargar de nuevo / eliminar / limpiar**;
- **Configuración** — carpeta predeterminada, descargas simultáneas, turbo, calidad predeterminada, audio, tema, notificaciones, comando al completar y retención del historial;
- La cola, el historial y la configuración se **persisten en disco** (`settings.json`, `history.json`, `queue.json`) y se restauran al reiniciar — incluida la **recuperación de descargas interrumpidas** (los jobs vuelven a la cola como *esperando*).

### Empacado (instalador Windows)

El instalador **StreamGrab-Setup-<versión>.exe** (NSIS) se genera con **electron-builder**. Los binarios externos (FFmpeg de `vendor/ffmpeg/` — **incluidas las DLLs del build compartido**, yt-dlp del paquete `youtube-dl-exec` y, si está presente, curl-impersonate de `tools/`) se empaquetan en `extraResources` (carpetas `resources/bin/`) — en producción la app resuelve los binarios por `process.resourcesPath`, así que la **máquina destino no necesita** Node.js, FFmpeg ni yt-dlp instalados manualmente.

```powershell
npm run pack:resources   # copia los binarios a build/extraResources/bin
npm run dist             # genera dist/StreamGrab-Setup-<versión>.exe (Windows)
npm run dist:dir         # build sin instalador (dist/win-unpacked) — para probar
npm run release          # dist + checksums SHA-256 (dist/SHA256SUMS.txt)
npm run update:ytdlp     # actualiza el binario de yt-dlp (todas las copias locales)
```

### Limitaciones (por diseño)

- No funciona con videos protegidos por DRM (Widevine/PlayReady) o contenido cifrado.
- No automatiza inicios de sesión ni captura cookies.
- No descubre ni fabrica tokens.
- Solo funciona con URLs que tú proporcionas y a las que ya tienes acceso autorizado.

Usa solo para contenido que tienes derecho a descargar.

---

<div align="center">

| 🇧🇷 [Português](#pt) | 🇺🇸 [English](#en) | 🇪🇸 [Español](#es) |
|---|---|---|

</div>
