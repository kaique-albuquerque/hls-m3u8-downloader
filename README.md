# Video Downloader — HLS (.m3u8) via FFmpeg

Aplicação **CLI em Node.js** para baixar videoaulas reproduzidas via HLS (arquivos `.m3u8`) usando o **FFmpeg**, de forma simples e segura no Windows.

> ⚠️ **Uso responsável**
> Esta ferramenta trabalha **somente** com URLs que você mesmo fornece e para as quais você já tem **acesso legítimo e autorizado** pela plataforma. Ela **não** faz bypass de DRM (Widevine etc.), não burla autenticação, não captura cookies do navegador, não descobre credenciais e não tenta acessar nada além do que a URL fornecida já permite.

---

## Requisitos

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **Windows 10/11** (também funciona em macOS/Linux, mas a instalação automática do FFmpeg é só no Windows)
- **FFmpeg** — é baixado **automaticamente** pelo `npm install` (para `vendor/ffmpeg/`). Alternativamente, instale manualmente e adicione ao PATH.

> 💡 O `npm install` roda um script (`postinstall`) que baixa o build *essentials* do FFmpeg (gyan.dev) e o instala localmente em `vendor/ffmpeg/`. O programa usa o binário local se existir; senão, usa o `ffmpeg` do PATH. Para instalar/atualizar manualmente: `npm run ffmpeg:install`.

---

## Instalação

```powershell
cd video-downloader
npm install
```

> O programa em si **não usa dependências de runtime** — dá para rodar direto com `node src/index.js` sem `npm install`. O `npm install` instala apenas o **ntl** (menu opcional de scripts) como dependência de desenvolvimento.

---

## Como executar

**Recomendado (contorna CDNs com bloqueio de cliente não-navegador, como a Mídia Stream):**

```powershell
npm run download:curl
```

Básico:

```powershell
npm start
```

ou

```powershell
node src/index.js
```

### Exemplo de uso completo

```
==============================================
   Video Downloader — HLS (.m3u8) via FFmpeg
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

### Argumentos de linha de comando

```powershell
node src/index.js --referer "https://exemplo.com/" --origin "https://exemplo.com" --user-agent "Mozilla/5.0 ..."
```

- `--referer <URL>` — envia o header `Referer`
- `--origin <URL>` — envia o header `Origin`
- `--user-agent "<UA>"` — envia o header `User-Agent`
- `--help` — mostra a ajuda

Os mesmos headers podem ser definidos em um arquivo `config.json` na pasta do projeto (veja `config.example.json`). Os valores informados na linha de comando têm prioridade sobre o arquivo.

---

## Como obter uma Request URL `.m3u8` pelo DevTools

1. Acesse a plataforma e **inicie a reprodução** da aula no navegador (Chrome/Edge).
2. Pressione `F12` para abrir o DevTools.
3. Vá para a aba **Network** (Rede).
4. No campo de filtro, digite `m3u8` (ou `media`).
5. Dê **play/pause** no vídeo (ou recarregue a página) para gerar as requisições.
6. Clique na requisição que termina em `.m3u8` — ela pode aparecer como `index.m3u8`, `master.m3u8`, `playlist.m3u8` etc.
7. Clique com o botão direito → **Copy → Copy request URL** (Copiar URL da solicitação) e cole no programa.

> 💡 **Os tokens expiram rápido** (minutos, às vezes segundos). Cole a URL e execute o download logo em seguida. Se o download falhar com 403, obtenha uma URL nova.

---

## Master playlist × Variant playlist

| Tipo | O que contém | Exemplo de linha |
|---|---|---|
| **Master** | Lista de variantes (resoluções) | `#EXT-X-STREAM-INF:BANDWIDTH=1753000,RESOLUTION=1920x1080` |
| **Variant** | Os segmentos `.ts`/`.m4s` do vídeo em si | `#EXTINF:6.000000,` |

- Se você colar uma **master**, o programa lista as resoluções encontradas (1080p, 720p, 480p…) e deixa você escolher, ou escolhe a **melhor disponível** (Enter).
- Se você colar uma **variant**, o programa usa diretamente.
- URLs relativas dentro da playlist são resolvidas corretamente contra a master (`new URL(childUrl, masterUrl)`).

---

## Como escolher 1080p

Cole a master `.m3u8` → quando aparecer a lista de qualidades, digite o número da opção `1920x1080` (ou aperte **Enter** para a melhor disponível, que normalmente já é a 1080p).

Se a plataforma não oferecer 1080p na lista, nenhuma opção vai "criar" essa resolução — o download usa o que está disponível.

---

## O que significa o erro 403

O servidor **recusou a requisição**. As causas mais comuns:

1. **Token expirado** — a URL temporária deixou de valer. Obtenha uma nova Request URL no DevTools.
2. **Headers ausentes** — o servidor exige headers iguais aos do navegador (`Referer`, `Origin`, `User-Agent`). Configure-os em `config.json` ou pelos argumentos `--referer`/`--origin`/`--user-agent`.
3. **CDN com bloqueio de cliente não-navegador** — alguns CDNs (ex.: **mediastre.am / MediastreamCDN**, usado pela plataforma Mídia Stream) usam *fingerprinting TLS*: o servidor identifica que a requisição não veio de um navegador real (Chrome/Firefox) e responde `403` mesmo com tokens válidos e headers corretos. **Nesse caso o download via FFmpeg é recusado pelo próprio servidor** — mas o modo curl-impersonate resolve (veja abaixo), desde que você use a **URL do player** (com `at=web-app` + as variáveis `uid/sid/pid/av` do console), não a URL crua do CDN (que dá `403` até no navegador).

O programa **não** tenta burlar nada disso: sem token novo ou sem acesso do servidor, não há download.

---

## Modo curl-impersonate (contornar bloqueio de cliente não-navegador)

Para CDNs com *fingerprinting TLS* (item 3 acima), o programa oferece um modo extra que **imita o TLS de um navegador real (Chrome)** ao fazer as requisições. O FFmpeg entra apenas para **remuxar os arquivos localmente** — ele não toca na rede, então o bloqueio não se aplica.

### Como funciona

1. O programa detecta/usa o binário **curl-impersonate** — formato **v2.x** (`curl-impersonate.exe` + perfis `curl_<browser><versão>.bat`; o formato antigo v1.x, `curl_chrome*.exe`, também é suportado).
2. Ele baixa a master playlist e a playlist de segmentos com o TLS imitado (perfil `chrome146` por padrão, com lista de fallback).
3. Baixa os **segmentos** (e chaves AES-128 / init segments, se houver) em paralelo, com tentativas.
4. Gera uma **playlist local** apontando para os arquivos baixados e o FFmpeg faz o remux para `.mp4` (com o mesmo fallback de modos: `-c copy` → `aac_adtstoasc` → `-c:a aac`).

### Como ativar

- **Automaticamente:** ao receber `403`, o programa pergunta se você quer tentar o modo curl-impersonate.
- **Forçado:** rode com `npm run download:curl` (ou `node src/index.js --curl-impersonate`, ou `--ci`).

### Instalação do curl-impersonate (Windows)

1. Acesse <https://github.com/lexiforest/curl-impersonate/releases> (projeto original: <https://github.com/lwthiker/curl-impersonate>) e baixe o pacote para Windows (ex.: `curl-impersonate-win64.zip`).
2. Extraia o ZIP — o formato **v2.x** traz `curl-impersonate.exe` + vários `curl_chromeNNN.bat` / `curl_edgeNNN.bat` / `curl_firefoxNNN.bat`.
3. Copie a pasta para **uma** destas opções:
   - dentro deste projeto, em `video-downloader\tools\`; ou
   - adicione a pasta ao PATH do Windows.
4. Rode novamente com `npm run download:curl`.

> ⚠️ **Importante:** o curl-impersonate **não** contorna DRM (Widevine etc.) e **não** automatiza login nem captura cookies — ele apenas faz a conexão TLS parecer um navegador, usando a mesma URL que você já tem acesso. **Confira os termos de uso da plataforma** antes de usar, pois o download pode não ser permitido por ela.

---

## Fluxo mdstrm / MediastreamCDN (plataforma Mídia Stream)

O player da Mídia Stream (`mdstrm.com`) protege os vídeos com um **token curto (OTE) + vars de sessão** que são gerados quando a página carrega. **Copiar a URL de um `.m3u8` direto do DevTools dá `403` para tudo** (até para um navegador real), porque as variáveis (`pid`, `sid`, `uid`, `access_token`) daquela URL são amarradas à sessão do player e expiram/ficam inválidas fora dela.

### ✅ O programa converte automaticamente

Se você colar uma URL do CDN (`...cdn.mdstrm.com/...`) ou uma URL do player sem as variáveis, o programa **detecta sozinho** e converte para a URL do player — buscando as variáveis frescas na página pública do embed (`mdstrm.com/embed/<videoId>`), sem login nem cookies:

```
[mdstrm] URL da Mídia Stream detectada (videoId 6a03573096d73ba91827573a).
[mdstrm] Buscando credenciais do player no embed público para gerar tokens frescos...
[mdstrm] URL do player gerada: https://mdstrm.com/video/6a03573096d73ba91827573a.m3u8?at=web-app&uid=***&sid=***&pid=***&av=v7.0.86
```

**Basta colar a URL que você copiou do DevTools e dar Enter** — o restante é automático. Lembre de usar `--curl-impersonate` (ou `npm run download:curl`).

### Manual (opcional, se a conversão automática falhar)

1. Abra a página do vídeo na plataforma (ex.: `https://mdstrm.com/embed/<videoId>`) **ou** a página da aula no site.
2. No DevTools, console, leia as variáveis do player:
   `MDSTRMUID`, `MDSTRMSID`, `MDSTRMPID`, `VERSION` (ex.: `v7.0.86`).
3. Monte a URL do player:

   ```
   https://mdstrm.com/video/<videoId>.m3u8?at=web-app&uid=<MDSTRMUID>&sid=<MDSTRMSID>&pid=<MDSTRMPID>&av=<VERSION>
   ```

4. Cole **essa** URL no programa (com `--curl-impersonate`). O servidor responde com a master playlist contendo **tokens frescos** por variante; o programa baixa tudo e remuxa para `.mp4`.

> 💡 Os tokens gerados duram algumas horas; se der `403` no meio, o próprio programa refaz a conversão na próxima execução.
> 🔒 **Limite honesto:** DRM (Widevine/PlayReady) não é contornado — isso só funciona com vídeos de streaming HLS comum.

---

## Onde o vídeo é salvo

- Por padrão, na pasta **Downloads do usuário** do Windows (obtida programaticamente via `os.homedir()` — nenhum nome de usuário é fixado no código).
- Você pode digitar outra pasta no prompt; se ela não existir, o programa a cria.
- O nome do arquivo é **sanitizado** (caracteres inválidos do Windows como `< > : " / \ | ? *` são substituídos) e a extensão `.mp4` é adicionada automaticamente.
- Se o arquivo já existir, o programa pergunta: **S**obrescrever / **N**ovo nome / **C**ancelar.

---

## Qualidade e compatibilidade do MP4

1. Primeira tentativa: `-c copy` — **sem recodificação**, sem perda de qualidade (remux direto).
2. Se o MP4 apresentar incompatibilidade de áudio, tenta `-c copy -bsf:a aac_adtstoasc` (correção de container, ainda sem recodificar).
3. Por último, tenta `-c:v copy -c:a aac` (reconverte apenas o áudio para AAC, preservando o vídeo).

A conversão de áudio só é usada **quando necessário**.

---

## Segurança dos tokens

- Parâmetros sensíveis da URL (`token`, `access_token`, `authorization`, `auth`, `sid`, `uid`, `signature`, `sig`, `key` etc.) têm os valores **mascarados** (`***`) em toda exibição.
- A URL completa **nunca** é registrada em logs. O `downloads.log` (gerado na pasta do projeto) registra apenas data, nome do arquivo, qualidade usada e a URL **mascarada**.
- O que você cola no prompt vai direto para o Node (modo raw do terminal) — o PowerShell não interpreta `&`, `?`, `=`, `%` da URL, então **cole sem se preocupar com escaping**. Não monte comandos FFmpeg manualmente no PowerShell.
- **URL pela área de transferência:** se você apertar `Enter` vazio no prompt "URL do .m3u8", o programa lê automaticamente a URL copiada do clipboard (Windows). Útil quando o colar não funciona (ex.: rodando via `ntl`).

---

## Interromper com Ctrl+C

Pressione `Ctrl+C` a qualquer momento:

- **Durante o prompt**: encerra o programa.
- **Durante o download**: envia o comando de parada ao FFmpeg (finalização graciosa, o arquivo é fechado corretamente) e, se necessário, força a finalização após alguns segundos. **Nenhum processo órfão fica para trás.** Arquivos parciais são removidos.

---

## Estrutura do projeto

```
video-downloader/
  package.json
  config.example.json
  README.md
  tools/                # curl-impersonate (v2.x) — usado pelo modo --curl-impersonate
  vendor/ffmpeg/        # FFmpeg local (baixado automaticamente pelo npm install)
  scripts/
    install-ffmpeg.mjs  # baixa/instala o FFmpeg em vendor/ffmpeg/ (postinstall)
  test-curl-e2e.mjs     # suíte E2E: gera HLS local (AES-128/fMP4), testa download e conversão mdstrm
  src/
    index.js      # fluxo principal (CLI)
    ffmpeg.js     # verificação e execução do FFmpeg (local em vendor/ ou PATH)
    hls.js        # parsing de playlists e resoluções
    curlimp.js    # detecção/invocação do curl-impersonate (v2.x e v1.x)
    mdstrm.js     # conversão automática de URLs da Mídia Stream (CDN → player)
    input.js      # prompts interativos
    utils.js      # URLs, máscara, nomes de arquivo, helpers
```

## Testes

```powershell
npm test
```

A suíte E2E (`test-curl-e2e.mjs`) gera playlists HLS locais reais com o FFmpeg (MPEG-TS criptografado com AES-128 e fMP4 com EXT-X-MAP), sobe um servidor HTTP local e valida o fluxo completo do modo curl-impersonate — incluindo a detecção v2.x e a conversão de URLs da Mídia Stream. O `tools/` real é preservado (backup/restauração automática).

## Menu interativo (opcional, via ntl)

Para não digitar comandos, instale o [ntl](https://www.npmjs.com/package/ntl) (menu de scripts do npm):

```powershell
npm install --save-dev ntl
npx ntl        # abre o menu; escolha download:curl
nt             # reexecuta o último script escolhido
```

## Limitações (por design)

- Não funciona com vídeos protegidos por DRM (Widevine/PlayReady) ou conteúdo criptografado.
- Não automatiza login nem captura cookies.
- Não descobre nem fabrica tokens.
- Só funciona com URLs que você fornece e às quais você já tem acesso autorizado.

Use apenas para conteúdo que você tem o direito de baixar.
