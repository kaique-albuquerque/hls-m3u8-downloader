# StreamGrab — Auditoria de Segurança: Vetores de Ataque em `src/drm/downloader.js`

## Visão Geral

O arquivo `src/drm/downloader.js` contém um **esqueleto de bypass de DRM** com stubs não implementados. Este documento mapeia cada vetor de ataque, o que faltaria para torná-lo funcional, e as defesas existentes.

---

## 1. Cadeia de Chamadas — Fluxo de Execução

```
download(url)
  ├─ detectDRM(url) → ffprobe → identifyDRM()
  │    └─ retorna: 'widevine' | 'playready' | 'fairplay' | null
  │
  ├─ downloadWidevine(url)
  │    ├─ fetchManifest(url)          ← STUB: retorna HTML genérico
  │    ├─ extractLicenseUrl(manifest) ← STUB: retorna 'https://example.com/license'
  │    ├─ requestWidevineLicense()    ← STUB: retorna ''
  │    └─ runFFmpeg(['-key', key])   ← USARIA chave obtida
  │
  ├─ downloadPlayReady(url)
  │    ├─ fetchManifest(url)
  │    ├─ fetchPlayReadyCertificate() ← STUB: retorna 'certificado_base64'
  │    ├─ requestPlayReadyLicense()   ← STUB: retorna 'licenca_base64'
  │    └─ runFFmpeg(['-cert', cert, '-license', license])
  │
  ├─ downloadFairPlay(url)
  │    ├─ fetchManifest(url)
  │    ├─ generateFairPlayToken()     ← STUB: retorna 'token_fairplay'
  │    └─ runCurl(['--impersonate', 'safari', '--header', 'Authorization: Bearer ...'])
  │
  └─ downloadNormal(url)
       └─ downloadWithYtDlpFallback(url)
            └─ downloadWithAdvancedFallbacks(url)
                 └─ runFFmpeg([...args, '-i', url])  ← VULNERABILIDADE AQUI
```

---

## 2. Stubs e O que Faltaria para Funcionar

### 2.1 Widevine (Netflix, Disney+, etc.)

| Método | Stub Atual | O que Faltaria | Ferramenta Necessária |
|--------|-----------|----------------|----------------------|
| `extractLicenseUrl()` (linha 264) | `return 'https://example.com/license'` | Parsear `<ContentProtection>` do MPD/M3U8 e extrair URL do servidor de licenças | Parsing XML de manifests DASH |
| `requestWidevineLicense()` (linha 275) | `return this.runCurl([...], '')` com URL hardcoded | Enviar challenge (PSSH) pro servidor e receber chave de descriptografia | CDM (Content Decryption Module) ou `pywidevine` |
| `runFFmpeg(['-key', key])` (linha 108) | FFmpeg não aceita `-key` sozinho | Usar `mp4decrypt --key <kid>:<key>` do Bento4 | `mp4decrypt` (Bento4) |

**Passo a passo do atacante para Widevine:**

```bash
# 1. Instalar pywidevine
pip install pywidevine

# 2. Extrair CDM (Content Decryption Module) de um Chrome
# (requer acesso ao binário do Chrome com Widevine CDM)

# 3. Usar pywidevine pra requisitar licença
pywidevine -c cdm_device.bin -p pssh.bin -l license_url

# 4. Usar mp4decrypt com a chave obtida
mp4decrypt --key <kid>:<key> encrypted_video.mp4 decrypted_video.mp4
```

### 2.2 PlayReady (Microsoft, Xbox, Smart TV)

| Método | Stub Atual | O que Faltaria | Ferramenta Necessária |
|--------|-----------|----------------|----------------------|
| `fetchPlayReadyCertificate()` (linha 289) | `return 'certificado_base64'` | Baixar certificado SL3000 do servidor PlayReady | Conexão com servidor PlayReady |
| `requestPlayReadyLicense()` (linha 298) | `return 'licenca_base64'` | Enviar challenge PlayReady e receber chave | `pyplayready` |
| `runFFmpeg(['-cert', cert, '-license', license])` (linha 132) | FFmpeg não aceita `-cert`/`-license` | Usar `mp4decrypt` com chave obtida | `mp4decrypt` (Bento4) |

### 2.3 FairPlay (Apple, iTunes)

| Método | Stub Atual | O que Faltaria | Ferramenta Necessária |
|--------|-----------|----------------|----------------------|
| `generateFairPlayToken()` (linha 306) | `return 'token_fairplay'` | Obter asset key do servidor FairPlay via sessão HLS | Extração do manifest HLS + sessão autenticada |
| `runCurl(['--impersonate', 'safari', ...])` (linha 157) | curl-impersonate funcional | Usar token pra baixar conteúdo descriptografado | Implementação FairPlay é a mais fechada |

---

## 3. Vulnerabilidade: Command Injection

### Localização

**Arquivo:** `src/drm/downloader.js`
**Linhas:** 279-284 (`downloadWithAdvancedFallbacks`)

```js
async downloadWithAdvancedFallbacks(url, options) {
  const attempts = [
    ['-c', 'copy'],
    ['-c:v', 'copy', '-c:a', 'aac', '-strict', '-2', '-bsf:a', 'aac_adtstoasc'],
    // ...
  ];
  
  for (const attempt of attempts) {
    return await this.runFFmpeg([...attempt, '-i', url, '-o', options.output]);
    //                                                     ↑ URL entra aqui sem sanitização
  }
}
```

### Análise

**Linha de execução:**

```
downloadNormal(url)
  → downloadWithYtDlpFallback(url)
    → downloadWithAdvancedFallbacks(url)
      → runFFmpeg([...args, '-i', url, '-o', options.output])
        → spawn('ffmpeg', args)  // ← URL passada diretamente ao spawn
```

**Status real da vulnerabilidade:**

- `spawn()` do Node.js **NÃO passa por shell** por padrão (diferente de `exec()`)
- Isso mitiga o vetor clássico de command injection via shell
- Porém, o FFmpeg em si pode ter comportamento inesperado com URLs maliciosas
- A URL **não é validada** antes de ser passada ao FFmpeg

**Exemplo de payload teórico (não funcionaria via spawn, mas ilustra o risco):**

```
https://example.com/video.mp4" -i /etc/passwd -o /tmp/leaked.txt "
```

### Vetores similares no mesmo arquivo

| Linha | Método | Vetor |
|-------|--------|-------|
| 108-112 | `downloadWidevine()` | `ffmpegArgs = ['-i', url, '-c', 'copy', '-key', key, '-o', outputFile]` |
| 132-135 | `downloadPlayReady()` | `ffmpegArgs = ['-i', url, '-c', 'copy', '-cert', cert, '-license', license, '-o', outputFile]` |
| 239 | `runFFmpeg()` | `spawn('ffmpeg', args)` — sem validação de argumentos |
| 270 | `runCurl()` | `spawn('curl-impersonate', args)` — sem validação de argumentos |

---

## 4. Vulnerabilidade: Identificação de DRM Frágil

### Localização

**Arquivo:** `src/drm/downloader.js`
**Linhas:** 75-95 (`identifyDRM`)

```js
identifyDRM(info) {
  // Widevine detectado por: legendas WebVTT/TTML
  if (info.streams.some(s => s.codec_type === 'subtitle' && 
      (s.codec_name.includes('webvtt') || s.codec_name.includes('ttml')))) {
    return 'widevine';
  }
  
  // PlayReady detectado por: tag Microsoft OU codec hvc1
  if (info.format.tags?.['com.microsoft.playready'] ||
      info.format.tags?.['com.apple.streaming'] ||
      info.streams.some(s => s.codec_name.includes('hvc1'))) {
    return 'playready';
  }
  
  // FairPlay detectado por: hvc1 + f4v1
  if (info.streams.some(s => s.codec_name.includes('hvc1') && 
      s.codec_tag_string === 'f4v1')) {
    return 'fairplay';
  }
  
  return null;
}
```

### Problemas

| Problema | Impacto |
|----------|---------|
| WebVTT/TTML ≠ Widevine | Qualquer vídeo com legendas seria classificado como Widevine |
| `hvc1` (H.265) ≠ PlayReady | Qualquer vídeo H.265 seria classificado como PlayReady |
| `f4v1` é tag de container Adobe, não FairPlay | Detecção incorreta |
| Não verifica `<ContentProtection>` no manifest | DRM real não seria detectado |
| Não verifica PSSH boxes no init segment | DRM em streams não seria detectado |

---

## 5. Vulnerabilidade: Ausência de Sanitização de Manifestos

### Localização

**Arquivo:** `src/drm/downloader.js`
**Linhas:** 254-258 (`fetchManifest`)

```js
fetchManifest(url) {
  return this.runCurl(['--impersonate', 'chrome', url], '');
}
```

### Risco

O manifesto retornado é usado diretamente em:
- `extractLicenseUrl(manifest)` — parseia XML sem validação
- `requestWidevineLicense(licenseUrl, manifest)` — envia como body

**Vetor de ataque:** Se o manifesto for interceptado (MITM ou cache poisoning), um atacante poderia:
1. Injetar URL de licença maliciosa
2. Redirecionar request de licença pra servidor controlado
3. Injetar scripts no manifesto XML

---

## 6. Defesas Existentes ✅

### 6.1 Rejeição de DRM nos Providers (Barreira Principal)

| Arquivo | Função | O que faz |
|---------|--------|-----------|
| `src/providers/hls/drm.js` | `checkHlsDrm(text)` | Escaneia `#EXT-X-KEY`/`#EXT-X-SESSION-KEY`, lança `UnsupportedDrmError` para SAMPLE-AES/FairPlay/Widevine/PlayReady |
| `src/providers/hls/drm.js` | `isSupportedEncryption()` | Só aceita `NONE` / `AES-128` com `identity` keyformat |
| `src/providers/dash/drm.js` | `checkDashDrm(text)` | Escaneia `<ContentProtection>`, lança `UnsupportedDrmError` se encontrar DRM |
| `src/core/errors.js` | `UnsupportedDrmError` | Classe de erro usada pelos providers |

### 6.2 Isolamento do DRMDownloader

| Barreira | Descrição |
|----------|-----------|
| `runCliSession()` | Usa os providers, que rejeitam DRM antes de chegar ao `DRMDownloader` |
| `runDownloadCommand()` | Delega pra `runCliSession()`, que usa providers |
| Providers chamados antes | `resolveSourceAdapterAsync()` → adapter.analyze() → checkDashDrm/checkHlsDrm |

**Fluxo normal:**

```
runDownloadCommand(url)
  → runCliSession(url)
    → resolveSourceAdapterAsync(url)
      → adapter.analyze()
        → checkDashDrm() / checkHlsDrm()  ← REJEITA DRM AQUI
    → Se DRM detectado: ERRO, não chega ao DRMDownloader
```

### 6.3 Segurança do Electron

| Configuração | Valor | Proteção |
|--------------|-------|----------|
| `nodeIntegration` | `false` | Renderer não acessa Node.js |
| `contextIsolation` | `true` | Preload bridge isolado |
| `sandbox` | `true` | Renderer roda em sandbox do OS |
| IPC validation | `electron/security.js` | Valida URLs, filenames, taskId |

### 6.4 Proteção de Dados Sensíveis

| Mecanismo | Local | O que protege |
|-----------|-------|---------------|
| `SENSITIVE_HEADER_NAMES` | `src/core/logger.js:16` | Redacta Authorization, Cookie, API-Key nos logs |
| `SENSITIVE_OBJECT_KEYS` | `src/core/logger.js:19` | Redacta token, secret, password, jwt nos logs |
| `redactText()` | `src/core/logger.js:28` | Pipeline completo de redação automática |

---

## 7. Mapa de Fragilidades

| # | Fragilidade | Arquivo | Linhas | Risco | Facilidade |
|---|-------------|---------|--------|-------|------------|
| 1 | `DRMDownloader` existe com arquitetura completa | `src/drm/downloader.js` | 1-370 | 🟡 Alto | Fácil — substituir stubs |
| 2 | `src/index.js` exporta `detectDRM()` usando `DRMDownloader` | `src/index.js` | 86-107 | 🟡 Alto | Fácil — ponto de entrada público |
| 3 | `downloadNormal()` passa URL sem sanitização ao FFmpeg | `src/drm/downloader.js` | 279-284 | 🟠 Médio | Médio — spawn mitiga |
| 4 | `identifyDRM()` usa heurísticas incorretas | `src/drm/downloader.js` | 75-95 | 🟢 Baixo | Fácil — mas só detecta |
| 5 | Nenhuma validação de integridade no manifesto | `src/drm/downloader.js` | 254-258 | 🟡 Alto | Médio — manifesto falso |
| 6 | `runFFmpeg`/`runCurl` não validam argumentos | `src/drm/downloader.js` | 239, 270 | 🟠 Médio | Médio — depende do contexto |
| 7 | Stub `extractLicenseUrl` retorna URL hardcoded | `src/drm/downloader.js` | 264 | 🟢 Baixo | Fácil — substituir URL |
| 8 | `downloadWidevine` usa flag `-key` que FFmpeg não aceita | `src/drm/downloader.js` | 108-112 | 🟢 Baixo | Médio — trocar por mp4decrypt |

---

## 8. Próximos Passos de um Atacante (Passo a Passo)

### Fase 1: Reconhecimento (Já feito)

```
✅ Identificar src/drm/downloader.js como alvo
✅ Mapear stubs e entender a arquitetura
✅ Identificar que os providers rejeitam DRM (barreira principal)
✅ Identificar que src/index.js exporta detectDRM()
```

### Fase 2: Tornar Detecção Funcional

```js
// Substituir identifyDRM() por detecção real via manifest
identifyDRM(manifest) {
  // Widevine: buscar schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"
  if (manifest.includes('edef8ba9-79d6-4ace-a3c8-27dcd51d21ed')) return 'widevine';
  
  // PlayReady: buscar schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"
  if (manifest.includes('9a04f079-9840-4286-ab92-e65be0885f95')) return 'playready';
  
  // FairPlay: buscar #EXT-X-KEY com METHOD=SAMPLE-AES e KEYFORMAT="com.apple.streamingkeydelivery"
  if (manifest.includes('com.apple.streamingkeydelivery')) return 'fairplay';
  
  return null;
}
```

### Fase 3: Obter Chaves de Licença

```bash
# Instalar dependências
pip install pywidevine pyplayready

# Widevine: extrair CDM do Chrome
# (requer acesso ao binário do Chrome)

# PlayReady: usar certificado SL3000
pyplayready -c sl3000_cert.bin -p pssh.bin -l https://license.server/playready
```

### Fase 4: Descriptografar Conteúdo

```bash
# Substituir runFFmpeg por mp4decrypt
mp4decrypt --key <kid>:<key> encrypted.mp4 decrypted.mp4

# Ou para múltiplas chaves (multi-period)
mp4decrypt --key <kid1>:<key1> --key <kid2>:<key2> encrypted.mp4 decrypted.mp4
```

### Fase 5: Contornar Barreiras dos Providers

```js
// Chamar DRMDownloader diretamente, ignorando os providers
import { DRMDownloader } from './src/drm/downloader.js';

const downloader = new DRMDownloader({ outputDir: './downloads' });
await downloader.download('https://drm-protected-content.com/stream.mpd');
```

---

## 9. Recomendações de Mitigação

### Imediatas

1. **Remover `src/drm/downloader.js`** — O esqueleto não tem uso legítimo
2. **Remover export `detectDRM()` de `src/index.js`** — Ponto de entrada desnecessário
3. **Validar URLs em `runFFmpeg()`/`runCurl()`** — Aceitar apenas `http:`/`https:`
4. **Sanitizar manifestos** — Validar XML antes de parsear

### Médio Prazo

5. **Auditar exports públicos de `src/index.js`** — Remover funções não utilizadas
6. **Adicionar testes de segurança** — Command injection, bypass de detecção
7. **Rate limiting** — Prevenir abuso de downloads em massa
8. **Log de tentativas** — Registrar tentativas de uso do `DRMDownloader`

---

## 10. Conclusão

O `DRMDownloader` é um **esqueleto funcional** com stubs que precisam ser implementados. A barreira principal são os **providers** (`providers/hls/drm.js`, `providers/dash/drm.js`) que rejeitam DRM antes de chegar ao bypass. Porém, se alguém chamar `DRMDownloader.download()` diretamente, os stubs são a única barreira.

A remoção do arquivo é a mitigação mais eficaz. Se manter para testes, deve ser isolado em módulo não-exportado com validação rigorosa de entrada.