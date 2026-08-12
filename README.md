<div align="center">

# StreamGrab

**Fast, universal video downloader for HLS, DASH, YouTube and the web.**

| 🇧🇷 [Português](#pt) | 🇺🇸 [English](#en) | 🇪🇸 [Español](#es) |
|---|---|---|

</div>

---

<h2 id="pt">🇧🇷 Português</h2>

Aplicativo **CLI em Node.js** (com interface **Electron** opcional) para baixar vídeos de **HLS (.m3u8)**, **DASH (.mpd)**, **YouTube**, **redes sociais** e **arquivos diretos** usando o **FFmpeg**, de forma simples e segura no Windows. Suporta Mídia Stream (mdstrm) via curl-impersonate, download paralelo (turbo) em URLs diretas e mux de vídeo+áudio para máxima qualidade.

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

Básico:

```powershell
node src/index.js
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
  tools/                # curl-impersonate (v2.x) — usado pelo modo --curl-impersonate
  vendor/ffmpeg/        # FFmpeg local (baixado automaticamente pelo npm install)
  scripts/
    install-ffmpeg.mjs  # baixa/instala o FFmpeg em vendor/ffmpeg/ (postinstall)
  tests/
    unit/               # testes unitários (node:test)
    integration/        # testes de integração (servidores locais + FFmpeg)
    e2e/                # suíte E2E: gera HLS local (AES-128/fMP4), MP4 direto, DASH e mdstrm
  src/
    index.js          # fluxo principal (CLI)
    cli-flow.js       # orquestração da sessão CLI (enxuto)
    cli/              # módulos do fluxo CLI
      context.js      # contexto, MODE_LABELS, interrupção (Ctrl+C)
      ui.js           # impressões, seleção de variante, nome de arquivo
      progress.js     # barra de progresso (CLI e Electron)
      config.js       # config.json, headers de CLI/DevTools
      download.js     # fluxos FFmpeg (direto e mux de vídeo+áudio)
      curl-flow.js    # fluxo curl-impersonate (segmentos HLS)
    adapters/         # adaptadores de fonte (contrato analyze/prepareDownload)
      ytdlp.js        # motor genérico yt-dlp (qualquer site suportado)
      youtube.js      # adaptador fino de YouTube
      social.js       # adaptador fino de redes sociais (Facebook, Instagram,
                      # TikTok, X/Twitter, Reddit, Twitch, Vimeo, etc.)
    source-adapters.js  # roteamento URL → adaptador
    legacy/           # motor antigo de YouTube (SABR) — só usado pelo teste E2E
      youtube.js
      youtube-signature.js
    ffmpeg.js       # verificação e execução do FFmpeg (local em vendor/ ou PATH)
    hls.js          # parsing de playlists e resoluções
    dash.js         # parsing de manifestos DASH
    curlimp.js      # detecção/invocação do curl-impersonate (v2.x e v1.x)
    mdstrm.js       # conversão automática de URLs da Mídia Stream (CDN → player)
    input.js        # prompts interativos
    utils.js        # URLs, máscara, nomes de arquivo, helpers
```

### Testes

```powershell
npm test
```

A suíte E2E (`test-curl-e2e.mjs`) gera playlists HLS locais reais com o FFmpeg (MPEG-TS criptografado com AES-128 e fMP4 com EXT-X-MAP), sobe um servidor HTTP local e valida o fluxo completo do modo curl-impersonate — incluindo a detecção v2.x e a conversão de URLs da Mídia Stream. O `tools/` real é preservado (backup/restauração automática).

### Menu interativo (opcional, via ntl)

Para não digitar comandos, instale o [ntl](https://www.npmjs.com/package/ntl) (menu de scripts do npm):

```powershell
npm install --save-dev ntl
npx ntl        # abre o menu; escolha download:curl
nt             # reexecuta o último script escolhido
```

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

A **Node.js CLI application** to download videos streamed over HLS (`.m3u8` files) using **FFmpeg**, simple and safe on Windows.

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

Basic:

```powershell
node src/index.js
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
  tools/                # curl-impersonate (v2.x) — used by --curl-impersonate mode
  vendor/ffmpeg/        # local FFmpeg (downloaded automatically by npm install)
  scripts/
    install-ffmpeg.mjs  # downloads/installs FFmpeg into vendor/ffmpeg/ (postinstall)
  tests/
    unit/               # unit tests (node:test)
    integration/        # integration tests (local servers + FFmpeg)
    e2e/                # E2E suite: generates local HLS (AES-128/fMP4), direct MP4, DASH and mdstrm
  src/
    index.js      # main flow (CLI)
    ffmpeg.js     # FFmpeg detection and execution (local vendor/ or PATH)
    hls.js        # playlist parsing and resolutions
    curlimp.js    # curl-impersonate detection/invocation (v2.x and v1.x)
    mdstrm.js     # automatic Mídia Stream URL conversion (CDN → player)
    input.js      # interactive prompts
    utils.js      # URLs, masking, file names, helpers
```

### Tests

```powershell
npm test
```

The E2E suite (`test-curl-e2e.mjs`) generates real local HLS playlists with FFmpeg (AES-128 encrypted MPEG-TS and fMP4 with EXT-X-MAP), starts a local HTTP server, and validates the full curl-impersonate flow — including v2.x detection and Mídia Stream URL conversion. The real `tools/` is preserved (automatic backup/restore).

### Interactive menu (optional, via ntl)

To avoid typing commands, install [ntl](https://www.npmjs.com/package/ntl) (npm scripts menu):

```powershell
npm install --save-dev ntl
npx ntl        # opens the menu; choose download:curl
nt             # re-runs the last chosen script
```

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

Una **aplicación CLI en Node.js** para descargar videos reproducidos vía HLS (archivos `.m3u8`) usando **FFmpeg**, de forma sencilla y segura en Windows.

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

Básico:

```powershell
node src/index.js
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
  tools/                # curl-impersonate (v2.x) — usado por el modo --curl-impersonate
  vendor/ffmpeg/        # FFmpeg local (descargado automáticamente por npm install)
  scripts/
    install-ffmpeg.mjs  # descarga/instala FFmpeg en vendor/ffmpeg/ (postinstall)
  tests/
    unit/               # pruebas unitarias (node:test)
    integration/        # pruebas de integración (servidores locales + FFmpeg)
    e2e/                # suite E2E: genera HLS local (AES-128/fMP4), MP4 directo, DASH y mdstrm
  src/
    index.js      # flujo principal (CLI)
    ffmpeg.js     # verificación y ejecución de FFmpeg (local en vendor/ o PATH)
    hls.js        # parsing de playlists y resoluciones
    curlimp.js    # detección/invocación de curl-impersonate (v2.x y v1.x)
    mdstrm.js     # conversión automática de URLs de Mídia Stream (CDN → player)
    input.js      # prompts interactivos
    utils.js      # URLs, enmascarado, nombres de archivo, helpers
```

### Tests

```powershell
npm test
```

La suite E2E (`test-curl-e2e.mjs`) genera playlists HLS locales reales con FFmpeg (MPEG-TS cifrado con AES-128 y fMP4 con EXT-X-MAP), levanta un servidor HTTP local y valida el flujo completo del modo curl-impersonate — incluyendo la detección v2.x y la conversión de URLs de Mídia Stream. El `tools/` real se preserva (backup/restauración automática).

### Menú interactivo (opcional, vía ntl)

Para no teclear comandos, instala [ntl](https://www.npmjs.com/package/ntl) (menú de scripts de npm):

```powershell
npm install --save-dev ntl
npx ntl        # abre el menú; elige download:curl
nt             # reejecuta el último script elegido
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
