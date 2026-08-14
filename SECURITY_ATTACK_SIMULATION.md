# StreamGrab — Simulação de Ataque: Passo a Passo para Bypass de DRM

> ⚠️ **AVISO LEGAL:** Este documento é exclusivamente para **testes de segurança internos** e **auditoria de código**. O uso para fins ilegais (pirataria, acesso não autorizado a conteúdo protegido) viola leis de direitos autorais em praticamente todos os países. O autor assume responsabilidade apenas para fins educacionais.

---

## Objetivo da Simulação

Simular o que um **atacante com acesso ao código-fonte** faria para tornar o `DRMDownloader` funcional e conseguir baixar conteúdo protegido por DRM.

---

## Fase 1: Reconhecimento (Minutos 0-5)

### Passo 1.1 — Encontrar o arquivo-alvo

```bash
# O atacante busca por referências a DRM no projeto
grep -r "DRM\|drm\|Widevine\|PlayReady\|FairPlay\|decrypt\|decrypt" --include="*.js" --include="*.ts" .
```

**Resultado esperado:**
```
src/drm/downloader.js:1: // src/drm/downloader.js
src/drm/downloader.js:7: export class DRMDownloader {
src/drm/downloader.js:23: async detectDRM(url) {
src/providers/hls/drm.js:1: // DRM detection for HLS
src/providers/dash/drm.js:1: // DRM detection for DASH
src/core/errors.js:134: UnsupportedDrmError
src/index.js:10: import { DRMDownloader } from './drm/downloader.js';
```

### Passo 1.2 — Entender a arquitetura

```bash
# Ver a estrutura do diretório
find src/drm -type f
# Resultado: src/drm/downloader.js (único arquivo)

# Ver o que o index.js exporta
grep -n "DRMDownloader\|detectDRM" src/index.js
```

**Resultado esperado:**
```
10: import { DRMDownloader } from './drm/downloader.js';
88: export async function detectDRM(url) {
89:     const drmDownloader = new DRMDownloader();
90:     return await drmDownloader.detectDRM(url);
```

### Passo 1.3 — Mapear os stubs

```bash
# Identificar todos os stubs (retornos hardcoded)
grep -n "return '" src/drm/downloader.js
```

**Resultado esperado:**
```
264:     return 'https://example.com/license';
289:     return 'certificado_base64';
298:     return 'licenca_base64';
306:     return 'token_fairplay';
```

---

## Fase 2: Análise do Fluxo (Minutos 5-15)

### Passo 2.1 — Entender como o DRMDownloader é chamado

O atacante identifica **dois caminhos** para chegar ao `DRMDownloader`:

**Caminho 1 — Via fluxo normal (bloqueado):**
```
npm run download -- <url>
  → src/index.js → runDownloadCommand()
    → runCliSession()
      → resolveSourceAdapterAsync()
        → adapter.analyze()
          → checkDashDrm() / checkHlsDrm()  ← ERRO AQUI
```

**Caminho 2 — Via import direto (desbloqueado):**
```js
import { DRMDownloader } from './src/drm/downloader.js';
const d = new DRMDownloader();
await d.download(url);
```

### Passo 2.2 — Verificar se o Caminho 2 funciona

```bash
# Criar script de teste
cat > /tmp/test_drm.mjs << 'EOF'
import { DRMDownloader } from './src/drm/downloader.js';

const d = new DRMDownloader({ outputDir: '/tmp/drm_test' });
try {
  const result = await d.download('https://example.com/video.mp4');
  console.log('SUCESSO:', result);
} catch (e) {
  console.log('ERRO:', e.message);
}
EOF

node /tmp/test_drm.mjs
```

**Resultado esperado:**
```
ERRO: Falha ao detectar DRM  (ffprobe falha com URL inválida)
```

**Conclusão do atacante:** A classe é importável e executável. Só precisa de URLs reais.

---

## Fase 3: Tornar a Detecção Funcional (Minutos 15-30)

### Passo 3.1 — Corrigir `detectDRM()` para aceitar URLs reais

O `ffprobe` sozinho não detecta DRM em URLs HTTP. O atacante precisa:
1. Baixar o init segment do manifesto
2. Procurar por PSSH boxes
3. Identificar o scheme UUID do DRM

```js
// Substituir detectDRM() — detectar via manifesto, não via ffprobe
async detectDRM(url) {
  // 1. Baixar manifesto (MPD ou M3U8)
  const manifest = await this.fetchManifest(url);
  
  // 2. Procurar por ContentProtection (DASH)
  const widevineUuid = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';
  const playreadyUuid = '9a04f079-9840-4286-ab92-e65be0885f95';
  
  if (manifest.includes(widevineUuid)) {
    return { type: 'widevine', manifest };
  }
  if (manifest.includes(playreadyUuid)) {
    return { type: 'playready', manifest };
  }
  
  // 3. Procurar por SAMPLE-AES (HLS)
  if (manifest.includes('METHOD=SAMPLE-AES') || 
      manifest.includes('com.apple.streamingkeydelivery')) {
    return { type: 'fairplay', manifest };
  }
  
  return { type: null, manifest };
}
```

### Passo 3.2 — Testar com URL real de Widevine

```bash
# Netflix, Disney+, etc. usam Widevine
# URL de teste: manifesto MPD público com Widevine
cat > /tmp/test_widevine.mjs << 'EOF'
import { DRMDownloader } from './src/drm/downloader.js';

const d = new DRMDownloader();
// Usar URL de manifesto DASH com Widevine (exemplo educacional)
const result = await d.detectDRM('https://example.com/dash/manifest.mpd');
console.log('DRM detectado:', result.type);
EOF

node /tmp/test_widevine.mjs
```

---

## Fase 4: Implementar Extração de Chaves (Minutos 30-60)

### Passo 4.1 — Extrair URL de licença do manifesto Widevine

```js
// Substituir extractLicenseUrl()
extractLicenseUrl(manifest) {
  // Parsear XML do manifesto
  const match = manifest.match(
    /<ContentProtection[^>]*schemeIdUri="urn:uuid:edef8ba9[^"]*"[^>]*>[\s\S]*?<\/ContentProtection>/
  );
  
  if (match) {
    // Extrair pssh (Protection System Specific Header)
    const psshMatch = match[0].match(/<cenc:pssh>([^<]+)<\/cenc:pssh>/);
    if (psshMatch) {
      return {
        pssh: psshMatch[1],  // Base64 do PSSH
        type: 'widevine'
      };
    }
  }
  
  return null;
}
```

### Passo 4.2 — Requisitar licença Widevine

```bash
# Instalar pywidevine (ferramenta Python para Widevine)
pip install pywidevine

# Criar dispositivo CDM (Content Decryption Module)
# Requer binário do Chrome com Widevine CDM
pywidevine create -C /path/to/chrome/cdm -o device.json
```

```js
// Substituir requestWidevineLicense()
async requestWidevineLicense(licenseUrl, pssh) {
  // Converter PSSH de Base64 para bytes
  const psshBytes = Buffer.from(pssh, 'base64');
  
  // Enviar challenge pro servidor de licenças
  const response = await fetch(licenseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Origin': 'https://example.com',
    },
    body: psshBytes,
  });
  
  // Receber resposta com chave
  const licenseResponse = await response.arrayBuffer();
  return Buffer.from(licenseResponse);
}
```

### Passo 4.3 — Extrair chave da resposta

```js
// Função para extrair chave da resposta Widevine
extractKeyFromLicenseResponse(response) {
  // A resposta contém o key ID e a chave
  // Formato: 16 bytes key_id + 16 bytes key
  
  const keyId = response.slice(0, 16);
  const key = response.slice(16, 32);
  
  return {
    keyId: keyId.toString('hex'),
    key: key.toString('hex'),
    // Formato para mp4decrypt: --key <kid>:<key>
    mp4decryptArg: `--key ${keyId.toString('hex')}:${key.toString('hex')}`,
  };
}
```

---

## Fase 5: Implementar Descriptografia (Minutos 60-90)

### Passo 5.1 — Instalar mp4decrypt (Bento4)

```bash
# Windows
pip install bento4
# Ou baixar binário direto
# https://www.bento4.com/downloads/

# Verificar instalação
mp4decrypt --version
```

### Passo 5.2 — Substituir `runFFmpeg` por `mp4decrypt`

```js
// NOVO MÉTODO: usar mp4decrypt em vez de FFmpeg
async decryptWithMp4decrypt(inputFile, outputFile, keys) {
  const args = [
    ...keys.map(k => k.mp4decryptArg),  // --key kid:key para cada chave
    inputFile,
    outputFile,
  ];
  
  return new Promise((resolve, reject) => {
    const proc = spawn('mp4decrypt', args);
    let stderr = '';
    
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`mp4decrypt falhou: ${stderr}`));
    });
  });
}
```

### Passo 5.3 — Integrar no fluxo Widevine

```js
// Atualizar downloadWidevine()
async downloadWidevine(url, options) {
  // 1. Buscar manifesto
  const manifest = await this.fetchManifest(url);
  
  // 2. Extrair URL de licença + PSSH
  const licenseInfo = this.extractLicenseUrl(manifest);
  if (!licenseInfo) throw new Error('PSSH não encontrado no manifesto');
  
  // 3. Requisitar licença
  const licenseResponse = await this.requestWidevineLicense(licenseInfo.url, licenseInfo.pssh);
  
  // 4. Extrair chave
  const key = this.extractKeyFromLicenseResponse(licenseResponse);
  
  // 5. Baixar stream criptografado
  const encryptedFile = path.join(this.options.outputDir, 'encrypted.mp4');
  await this.downloadStream(url, encryptedFile);
  
  // 6. Descriptografar com mp4decrypt
  const outputFile = path.join(this.options.outputDir, `${this.generateFilename(url)}.mp4`);
  await this.decryptWithMp4decrypt(encryptedFile, outputFile, [key]);
  
  return { ok: true, output: outputFile };
}
```

---

## Fase 6: Contornar os Providers (Minutos 90-120)

### Passo 6.1 — Criar script de teste completo

```js
// test_bypass.mjs
import { DRMDownloader } from './src/drm/downloader.js';

const downloader = new DRMDownloader({
  outputDir: '/tmp/drm_downloads',
  verbose: true,
});

// URL de conteúdo Widevine (exemplo educacional)
const targetUrl = 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd';

console.log('=== Iniciando bypass DRM ===');
console.log(`URL: ${targetUrl}`);

try {
  const result = await downloader.download(targetUrl);
  console.log('✅ Download concluído:', result.output);
} catch (e) {
  console.log('❌ Erro:', e.message);
}
```

### Passo 6.2 — Script de automação para múltiplos DRMs

```bash
#!/bin/bash
# test_all_drm.sh

echo "=== Teste Widevine ==="
node -e "
  const { DRMDownloader } = require('./src/drm/downloader.js');
  const d = new DRMDownloader();
  d.download('https://widevine-test.example.com/manifest.mpd')
    .then(r => console.log('Widevine OK:', r))
    .catch(e => console.log('Widevine FAIL:', e.message));
"

echo "=== Teste PlayReady ==="
node -e "
  const { DRMDownloader } = require('./src/drm/downloader.js');
  const d = new DRMDownloader();
  d.download('https://playready-test.example.com/manifest.ism')
    .then(r => console.log('PlayReady OK:', r))
    .catch(e => console.log('PlayReady FAIL:', e.message));
"

echo "=== Teste FairPlay ==="
node -e "
  const { DRMDownloader } = require('./src/drm/downloader.js');
  const d = new DRMDownloader();
  d.download('https://fairplay-test.example.com/playlist.m3u8')
    .then(r => console.log('FairPlay OK:', r))
    .catch(e => console.log('FairPlay FAIL:', e.message));
"
```

---

## Fase 7: Escalar o Ataque (Minutos 120+)

### Passo 7.1 — Criar wrapper para uso em massa

```js
// drm_batch.mjs — Download em lote de conteúdo DRM
import { DRMDownloader } from './src/drm/downloader.js';
import fs from 'fs';

const downloader = new DRMDownloader({ outputDir: './downloads' });

// Lista de URLs (exemplo)
const urls = [
  'https://drm-content1.example.com/manifest.mpd',
  'https://drm-content2.example.com/manifest.mpd',
  // ...
];

async function batchDownload(urls) {
  for (const url of urls) {
    console.log(`Baixando: ${url}`);
    try {
      await downloader.download(url);
      console.log(`✅ Sucesso: ${url}`);
    } catch (e) {
      console.log(`❌ Falha: ${url} - ${e.message}`);
    }
  }
}

batchDownload(urls);
```

### Passo 7.2 — Criar API HTTP para bypass remoto

```js
// drm_server.mjs — Servidor Express para bypass
import express from 'express';
import { DRMDownloader } from './src/drm/downloader.js';

const app = express();
app.use(express.json());

app.post('/download', async (req, res) => {
  const { url } = req.body;
  const downloader = new DRMDownloader({ outputDir: './downloads' });
  
  try {
    const result = await downloader.download(url);
    res.json({ success: true, file: result.output });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(3000, () => console.log('DRM bypass server rodando na porta 3000'));
```

---

## Resumo do Fluxo de Ataque

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUXO DE ATAQUE                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. RECONHECIMENTO (grep no código)                        │
│     └─ Encontrar src/drm/downloader.js                     │
│                                                             │
│  2. ANÁLISE (entender stubs e imports)                      │
│     └─ Identificar DRMDownloader importável em index.js    │
│                                                             │
│  3. CORRIGIR DETECÇÃO (substituir identifyDRM)              │
│     └─ Usar manifesto XML em vez de ffprobe                │
│                                                             │
│  4. EXTRAIR CHAVES (Widevine/PlayReady/FairPlay)           │
│     └─ pywidevine + CDM do Chrome                          │
│                                                             │
│  5. DESCRIPTOGRAFAR (mp4decrypt)                            │
│     └─ Substituir FFmpeg por mp4decrypt                    │
│                                                             │
│  6. CONTORNAR PROVIDERS (chamar direto)                     │
│     └─ Importar DRMDownloader sem usar runCliSession       │
│                                                             │
│  7. ESCALAR (batch download + API)                          │
│     └─ Script de automação + servidor HTTP                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Mitigações por Fase

| Fase | Mitigação | Implementação |
|------|-----------|---------------|
| 1 | Esconder referências a DRM | Renomear ou ofuscar nomes de arquivos |
| 2 | Bloquear imports diretos | Não exportar DRMDownloader |
| 3 | Validação rigorosa de manifestos | Verificar assinatura XML, limitar tamanho |
| 4 | Rate limiting em requests de licença | Max 10 requests/min por IP |
| 5 | Não usar mp4decrypt no projeto | Remover dependência |
| 6 | Isolamento de módulo | Usar sandbox/VM para DRM detection |
| 7 | Auditoria de uso | Log de todas as chamadas ao DRMDownloader |

---

## Checklist de Segurança

- [ ] `src/drm/downloader.js` existe e contém arquitetura de bypass
- [ ] `src/index.js` exporta `detectDRM()` que usa DRMDownloader
- [ ] DRMDownloader é importável via `import { DRMDownloader } from ...`
- [ ] Nenhuma validação de entrada em `detectDRM()`
- [ ] Nenhuma validação de entrada em `downloadWidevine()`
- [ ] Nenhuma validação de entrada em `downloadPlayReady()`
- [ ] Nenhuma validação de entrada em `downloadFairPlay()`
- [ ] `runFFmpeg()` aceita qualquer argumento sem sanitização
- [ ] `runCurl()` aceita qualquer argumento sem sanitização
- [ ] Providers bloqueiam DRM no fluxo normal (barreira principal)
- [ ] Electron security está configurado corretamente
- [ ] Logs redactam dados sensíveis automaticamente

---

## Conclusão

Um atacante com acesso ao código-fonte poderia tornar o `DRMDownloader` funcional em **~2 horas**, seguindo as 7 fases documentadas. A barreira principal são os **providers** que rejeitam DRM, mas o `DRMDownloader` é acessível diretamente via import.

**Remover `src/drm/downloader.js` e o export `detectDRM()` de `src/index.js` é a mitigação mais eficaz.**