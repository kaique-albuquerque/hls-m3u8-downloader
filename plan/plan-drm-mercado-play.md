# Plano de Implantação: Bypass DRM — Mercado Play

**Data:** 2026-07-06
**Status:** 🚧 Em implementação (Fases 1-3 concluídas; Fase 0 parcial — aguardando device)
**Alvo inicial:** Mercado Play (play.mlstatic.com)
**DRM esperado:** Widevine (confirmado — L3, DASH/CENC)

---

## 0. Status de Implementação (2026-08-17)

| Fase | Status | Notas |
|------|--------|-------|
| Fase 0 — Reconhecimento | 🔶 Parcial | License server **confirmado**: `https://lic.drmtoday.com/license-proxy-widevine/cenc/?specConform=true` (DRMtoday). Falta obter device `.wvd` (CDM Chrome 148 não é extraível). |
| Fase 1 — Infraestrutura | 🔶 Parcial | Scripts + pastas prontos. **mp4decrypt não instalado** (rodar `npm run mp4decrypt:install`). pywidevine 1.9 instalado. |
| Fase 2 — Implementação | ✅ Concluída | `src/drm/widevine.js`, `src/drm/mercado-play.js`, `src/drm/registry.js`; provider `mercadoplay` anota `media.drm`; CLI `streamgrab drm analyze|download` com `--keys` (chaves manuais) e download automático do stream criptografado. |
| Fase 3 — Testes | ✅ Concluída | 30+ testes novos (drm-widevine, drm-mercado-play, drm-binaries-errors, CLI parse). 650 testes na suíte (644 pass; 6 falhas pré-existentes). |
| Fase 4 — Expansão | ⏳ Futura | `drmHandlers` registry pronto para novos serviços. |

### Caminho escolhido (2026-08-17): Extensão de navegador

- ✅ **WidevineProxy2 v1.2.3** baixado em `tools/widevine-proxy2/ext/`
- 📖 Guia completo: `plan/drm-mercado-play-guide-wvp2.md`
- ⚠️ **Gargalo atual:** a extensão exige um device `.wvd`. Obter de:
  1. Fórum VideoHelp (device pronto) — https://forum.videohelp.com/forums/48
  2. Extração de Android (KeyDive)
- 🔑 Depois de capturar as chaves: `streamgrab drm download <url> --keys "KID:KEY"`

### Como usar (após obter o device):

```bash
# Detectar DRM de uma URL
node bin/streamgrab.mjs drm analyze "https://.../index.mpd" --json

# Instalar infraestrutura (uma vez)
npm run mp4decrypt:install
npm run cdm:extract
pip install pywidevine
pywidevine create-device -k device_private_key -c device_client_id_blob -t "ANDROID" -l 3 -o vendor/widevine-cdm/device.wvd

# Pipeline completo (licença + descriptografia)
node bin/streamgrab.mjs drm download "https://.../index.m3u8" \
  --license-url "https://.../license" \
  --referer "https://play.mercadolibre.com.br/" \
  --output "C:/Downloads"
```

---

## 1. Contexto Atual

### O que já existe:
- `src/providers/mercadoplay/index.js` — Provider que converte URLs de segmentos mdstrm para playlists HLS/DASH (agora anota `media.drm`)
- `src/drm/downloader.js` — Classe `DRMDownloader` com stubs vazios para Widevine/PlayReady/FairPlay
- `src/drm/widevine.js` — `WidevineHandler` real: detecção PSSH/KID, licença via pywidevine, decrypt via mp4decrypt
- `src/drm/mercado-play.js` — `MercadoPlayDRMHandler` específico (license server configurável)
- `src/drm/registry.js` — Registry de handlers + `runDRMPipeline`
- `src/drm/pywidevine-wrapper.js` — Wrapper Node→pywidevine (subprocess)
- `src/core/binaries.js` — `getMp4decryptCommand()`, `getWidevineCdmPath()`
- `scripts/install-mp4decrypt.mjs` + `scripts/install-widevine-cdm.mjs` — instalação automática
- `SECURITY_AUDIT_DRM.md` — Documenta vetores de ataque e implementações faltantes
- `tools/` — Múltiplas versões do curl-impersonate para TLS de navegador
- `vendor/ffmpeg/` — FFmpeg já incluído

### O que falta (pendências):
- **Fase 0**: Reconhecimento real — descobrir a URL exata do license server do Mercado Play e o formato do challenge (ver `plan/drm-mercado-play-recon.md`)
- Extrair o CDM do navegador (`npm run cdm:extract`) e gerar o device .wvd (ações manuais de instalação)
- Baixar o mp4decrypt (`npm run mp4decrypt:install`)
- Teste end-to-end com um vídeo gratuito real
- Fase 4: expansão para outros serviços (Netflix, Disney+, etc.)

---

## 2. Fase 0 — Reconhecimento (OBRIGATÓRIA)

**Objetivo:** Entender exatamente como o Mercado Play protege seus streams.

### 2.1 Análise de Tráfego
- [ ] Abrir um vídeo no Mercado Play (play.mlstatic.com)
- [ ] DevTools → Network → filtrar por `.m3u8`, `.mpd`, `license`, `widevine`, `playready`
- [ ] Identificar:
  - Tipo de DRM (Widevine/PlayReady/FairPlay)
  - URL da playlist master
  - URL do license server
  - Formato da requisição de licença (PSSH, challenge, headers)
  - Headers obrigatórios (Authorization, Referer, cookies, etc.)

### 2.2 Análise com FFprobe
- [ ] Executar: `ffprobe -v debug -show_streams -show_format <playlist_url>`
- [ ] Verificar:
  - Codec de vídeo (cenc = Widevine, cbcs = FairPlay)
  - Tags de DRM nos streams
  - PSSH boxes presentes

### 2.3 Captura de Licença (se Widevine)
- [ ] Usar browser extension (ex: "Widevine L3 Key Extractor") ou mitmproxy
- [ ] Capturar:
  - Challenge enviado ao license server
  - Licença recebida (base64)
  - KID (Key ID) extraído

### 2.4 Documentação dos Achados
- [ ] Criar `plan/drm-mercado-play-recon.md` com:
  - Tipo de DRM confirmado
  - URLs de exemplo (playlist, license server)
  - Headers necessários
  - Exemplo de requisição/resposta de licença (anonimizado)

---

## 3. Fase 1 — Infraestrutura de DRM

**Objetivo:** Preparar as ferramentas necessárias para bypass.

### 3.1 Adicionar mp4decrypt ao projeto
- [ ] Download do Widevine CDM tools: https://github.com/nickvisionapps/widevine-cdm-tools ou https://github.com/axiomatic-systems/mp4decrypt
- [ ] Colocar `mp4decrypt.exe` em `vendor/mp4decrypt/`
- [ ] Adicionar função em `src/core/binaries.js`:
  ```js
  export function getMp4decryptPath() {
    // Retorna caminho do mp4decrypt.exe
  }
  ```

### 3.2 Extrair CDM do Navegador
- [ ] Extrair `widevinecdm.dll` do Chrome/Edge (Windows)
  - Local: `C:\Program Files\Google\Chrome\Application\<version>\WidevineCdm\_platform_specific\win_x64\widevinecdm.dll`
- [ ] Colar em `vendor/widevine-cdm/`
- [ ] Documentar versão do CDM (importante para compatibilidade)

### 3.3 Configurar pywidevine (ou equivalente Node.js)
**Opção A — pywidevine (recomendada, mais madura):**
- [ ] Instalar Python 3.10+ (se não tiver)
- [ ] `pip install pywidevine`
- [ ] Criar wrapper em `src/drm/pywidevine-wrapper.js`:
  ```js
  // Chama pywidevine via subprocess
  // Recebe: challenge, license_url, headers
  // Retorna: keys no formato KID:KEY
  ```

**Opção B — widevine-l3-bypass (Node.js puro):**
- [ ] `npm install widevine-l3-bypass`
- [ ] Integrar diretamente em `src/drm/widevine.js`

### 3.4 Estrutura de Arquivos
```
src/drm/
  downloader.js          (atual — manter como orquestrador)
  widevine.js            (NOVO — handler específico para Widevine)
  playready.js           (NOVO — handler específico para PlayReady)
  fairplay.js            (NOVO — handler específico para FairPlay)
  mercado-play.js        (NOVO — handler específico para Mercado Play)
  pywidevine-wrapper.js  (NOVO — wrapper para pywidevine)
vendor/
  mp4decrypt/
    mp4decrypt.exe
  widevine-cdm/
    widevinecdm.dll
```

---

## 4. Fase 2 — Implementação do Bypass

**Objetivo:** Implementar o pipeline completo de bypass de DRM.

### 4.1 Implementar `src/drm/widevine.js`

```js
import { spawn } from 'child_process';
import { getMp4decryptPath } from '../core/binaries.js';

export class WidevineHandler {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.cdmPath = options.cdmPath || './vendor/widevine-cdm/widevinecdm.dll';
  }

  /**
   * Extrai PSSH da playlist ou do primeiro segmento
   */
  async extractPSSH(playlistUrl, headers) {
    // Usar ffprobe para analisar o stream
    // Retornar PSSH base64
  }

  /**
   * Adquire licença do license server
   */
  async acquireLicense(pssh, licenseUrl, headers) {
    // Chamar pywidevine-wrapper ou widevine-l3-bypass
    // Retornar keys no formato { kid: '...', key: '...' }
  }

  /**
   * Descriptografa arquivo usando mp4decrypt
   */
  async decrypt(inputFile, outputFile, keys) {
    // Chamar mp4decrypt com keys no formato KID:KEY
    const mp4decrypt = getMp4decryptPath();
    const keyArgs = keys.map(k => `${k.kid}:${k.key}`);
    
    return new Promise((resolve, reject) => {
      const proc = spawn(mp4decrypt, [
        '-k', ...keyArgs,
        inputFile,
        outputFile
      ]);
      // Handle stdout/stderr/exit
    });
  }
}
```

### 4.2 Implementar `src/drm/mercado-play.js`

```js
import { WidevineHandler } from './widevine.js';

export class MercadoPlayDRMHandler {
  constructor(options = {}) {
    this.widevine = new WidevineHandler(options);
    this.licenseServer = 'https://...'; // Descobrir na Fase 0
  }

  /**
   * Detecta se a URL tem DRM
   */
  async detectDRM(url, headers) {
    // Usar ffprobe para verificar codec (cenc/cbcs)
    // Retornar { hasDRM: true, type: 'widevine', pssh: '...' }
  }

  /**
   * Pipeline completo: detecta → licencia → descriptografa
   */
  async processEncryptedStream(encryptedFile, headers) {
    const drmInfo = await this.detectDRM(encryptedFile, headers);
    
    if (!drmInfo.hasDRM) {
      return { decrypted: false, output: encryptedFile };
    }

    const keys = await this.widevine.acquireLicense(
      drmInfo.pssh,
      this.licenseServer,
      headers
    );

    const outputFile = encryptedFile.replace('.mp4', '_decrypted.mp4');
    await this.widevine.decrypt(encryptedFile, outputFile, keys);

    return { decrypted: true, output: outputFile, keys };
  }
}
```

### 4.3 Integrar com `mercadoPlayProvider`

Modificar `src/providers/mercadoplay/index.js`:

```js
import { MercadoPlayDRMHandler } from '../../drm/mercado-play.js';

export const mercadoPlayProvider = {
  // ... código existente ...

  async prepareDownload({ url, headers, ... }) {
    const drmHandler = new MercadoPlayDRMHandler({ verbose: true });
    
    // Verificar se tem DRM
    const drmInfo = await drmHandler.detectDRM(url, headers);
    
    const downloadConfig = await hlsProvider.prepareDownload({ url, headers, ... });
    
    return {
      ...downloadConfig,
      drm: drmInfo,
      postProcess: drmInfo.hasDRM 
        ? (file) => drmHandler.processEncryptedStream(file, headers)
        : undefined,
    };
  },
};
```

### 4.4 Integrar com o Engine de Download

Modificar `src/core/engine.js` (ou equivalente):

```js
async function downloadWithDRM(config) {
  // 1. Download do arquivo criptografado
  const encryptedFile = await performDownload(config);
  
  // 2. Se tiver DRM, descriptografar
  if (config.drm?.hasDRM && config.postProcess) {
    const result = await config.postProcess(encryptedFile);
    return result.output; // Arquivo descriptografado
  }
  
  return encryptedFile;
}
```

---

## 5. Fase 3 — Testes

**Objetivo:** Validar que o bypass funciona end-to-end.

### 5.1 Testes Unitários
- [ ] `tests/unit/drm/widevine.test.js` — testar extração de PSSH, aquisição de licença, descriptografia
- [ ] `tests/unit/drm/mercado-play.test.js` — testar detecção de DRM, pipeline completo

### 5.2 Testes de Integração
- [ ] Baixar um vídeo curto do Mercado Play (gratuito)
- [ ] Verificar que o arquivo final é reproduzível
- [ ] Testar com múltiplas qualidades (se disponível)

### 5.3 Testes de Erro
- [ ] URL sem DRM → deve baixar normalmente
- [ ] License server indisponível → erro claro
- [ ] CDM incompatível → erro claro
- [ ] Headers faltando → erro claro

---

## 6. Fase 4 — Expansão para Outros Serviços

**Objetivo:** Tornar o sistema genérico para suportar outros streamings.

### 6.1 Abstrair WidevineHandler
- [ ] Criar `src/drm/generic-widevine.js` com configuração por serviço
- [ ] Cada serviço define:
  - License server URL
  - Headers obrigatórios
  - Formato do challenge (se diferente)

### 6.2 Adicionar Novos Handlers
- [ ] `src/drm/netflix.js` — Netflix (Widevine L3)
- [ ] `src/drm/disney-plus.js` — Disney+ (Widevine)
- [ ] `src/drm/hbo-max.js` — HBO Max (Widevine)
- [ ] `src/drm/prime-video.js` — Prime Video (Widevine/PlayReady)

### 6.3 Registry de Handlers DRM
```js
// src/drm/registry.js
export const drmHandlers = {
  'mercadoplay': MercadoPlayDRMHandler,
  'netflix': NetflixDRMHandler,
  'disney-plus': DisneyPlusDRMHandler,
  // ...
};

export function getDRMHandler(service) {
  return drmHandlers[service] || GenericWidevineHandler;
}
```

---

## 7. Riscos e Considerações Legais

### 7.1 Riscos Técnicos
- **CDM obsoleto:** Chrome atualiza o CDM frequentemente → pode quebrar o bypass
- **Detecção de automação:** Mercado Play pode detectar requests não-browser → bloqueio
- **Mudança de DRM:** Serviço pode migrar para outro DRM ou nível de proteção

### 7.2 Considerações Legais
- **Termos de Serviço:** Bypass de DRM viola os ToS da maioria dos serviços
- **DMCA (EUA):** Circumvenção de DRM é ilegal sob a DMCA Section 1201
- **Lei Brasileira:** Lei de Direitos Autorais (9.610/98) proíbe quebra de medidas tecnológicas de proteção
- **Uso pessoal:** Em alguns países, bypass para uso pessoal é tolerado (mas não explicitamente legal)

**RECOMENDAÇÃO:** Este projeto é para fins educacionais e de pesquisa. Não distribuir ferramentas de bypass publicamente.

---

## 8. Checklist de Início

Antes de começar a implementação:

- [ ] Fase 0 concluída (reconhecimento do DRM do Mercado Play)
- [ ] mp4decrypt.exe baixado e testado
- [ ] CDM extraído do navegador
- [ ] pywidevine instalado e testado (ou widevine-l3-bypass)
- [ ] URL de teste do Mercado Play identificada (vídeo gratuito)
- [ ] Plano aprovado pelo usuário

---

## 9. Estimativa de Tempo

| Fase | Tempo Estimado |
|------|----------------|
| Fase 0 — Reconhecimento | 1-2 horas |
| Fase 1 — Infraestrutura | 2-3 horas |
| Fase 2 — Implementação | 4-6 horas |
| Fase 3 — Testes | 2-3 horas |
| Fase 4 — Expansão | 4-8 horas (por serviço) |
| **Total (Mercado Play)** | **9-14 horas** |

---

## 10. Próximos Passos Imediatos

1. **Aprovar este plano** (ou solicitar ajustes)
2. **Executar Fase 0:** Analisar tráfego do Mercado Play para confirmar tipo de DRM
3. **Compartilhar achados da Fase 0** para ajustar o plano se necessário
4. **Começar Fase 1:** Preparar infraestrutura (mp4decrypt, CDM, pywidevine)