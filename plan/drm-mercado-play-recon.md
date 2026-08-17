# Reconhecimento DRM — Mercado Play (Fase 0)

> **Status:** ✅ Parcialmente concluído (2026-08-17)
> **Data:** 2026-08-17
> **Alvo:** Mercado Play (play.mlstatic.com / play.mercadolibre.com.br)

---

## ✅ Achados confirmados

| Item | Valor |
|------|-------|
| Tipo de DRM | **Widevine** (L3, DASH/CENC) |
| License server | **`https://lic.drmtoday.com/license-proxy-widevine/cenc/?specConform=true`** (DRMtoday) |
| Formato do manifesto | **DASH (.mpd)** com `<ContentProtection schemeIdUri="urn:uuid:edef8ba9...">` (Widevine) |
| PSSH | Extraído automaticamente pelo `detectWidevine()` do StreamGrab |
| Host de mídia | `tailor-ssai-vod.play.mlstatic.com` (SSAI) e `video-mpkg-msm-01-vod.play.mlstatic.com` |

**Status da infraestrutura:**
- ✅ CDM extraído: `vendor/widevine-cdm/widevinecdm.dll` (Chrome 148.0.7778.168)
- ✅ pywidevine 1.9.0 instalado (Python 3.13)
- ❌ **Device .wvd NÃO gerado** — CDM moderno do Chrome não é extraível pelas
  ferramentas clássicas (removidas/404). Caminhos: capturar chaves com
  extensão de navegador (WidevineProxy2) e usar `--keys`, ou obter device de
  comunidade (VideoHelp fórum), ou extrair de Android (KeyDive).
- ❌ mp4decrypt não instalado (rodar `npm run mp4decrypt:install`)

---

## 1. Como Coletar (passo a passo)

1. Abra o Chrome/Edge, faça login no Mercado Livre e abra um vídeo **gratuito** no Mercado Play.
2. Abra o DevTools (F12) → aba **Network**.
3. Filtre por: `m3u8`, `mpd`, `license`, `widevine`, `playready`, `pssh`.
4. Recarregue a página (F5) e reproduza o vídeo.
5. Localize:
   - A **playlist master** (`.m3u8` ou `.mpd`) — essa é a URL a passar para o StreamGrab.
   - A **requisição de licença** (geralmente `POST` para uma URL contendo `license`/`widevine`).
6. Copie os itens abaixo para preencher este documento.

> **Dica:** se preferir análise offline, use `ffprobe -v debug -show_streams -show_format <playlist_url>`.

---

## 2. Achados

### 2.1 Tipo de DRM

- [x] **Widevine** (confirmado — DASH/CENC, license server DRMtoday)
- [ ] PlayReady
- [ ] FairPlay
- [ ] Sem DRM (conteúdo livre)

**Confirmado:** Widevine L3 (DASH)

### 2.2 URLs de Exemplo

| Item | URL |
|------|-----|
| URL do vídeo (página) | (preencher) |
| Playlist master HLS | (preencher) |
| Playlist master DASH | `https://tailor-ssai-vod.play.mlstatic.com/v1/dash/<videoId>/mms-mplay-ssai-vod-interceptor/out/v1/.../index.mpd?aws.manifestfilter=...&aws.sessionId=...` |
| License server (Widevine) | `https://lic.drmtoday.com/license-proxy-widevine/cenc/?specConform=true` |
| License server (PlayReady) | — |

### 2.3 Requisição de Licença

**Método:** `POST` ☐ / `GET` ☐ / outro: ______

**Content-Type do corpo:**
- [ ] `application/octet-stream` (body bruto = challenge)
- [ ] `application/json` (`{"challenge": "..."}`)
- [ ] Outro: ______

**Headers obrigatórios:**

| Header | Valor (exemplo) | Obrigatório? |
|--------|-----------------|--------------|
| `Authorization` | `Bearer ...` | ☐ |
| `Referer` | `https://play.mercadolibre.com.br/...` | ☐ |
| `Origin` | `https://play.mercadolibre.com.br` | ☐ |
| `Cookie` | (sessão) | ☐ |
| `User-Agent` | Chrome/Edge | ☐ |
| Outro | | ☐ |

**PSSH capturado (base64):**

```
<cole o PSSH aqui>
```

**KID capturado (hex):**

```
<cole o KID aqui>
```

---

## 3. Exemplo de Comando com os Achados

Depois de preencher, o pipeline fica:

```bash
# 1. Verificar se o StreamGrab detecta o DRM
node bin/streamgrab.mjs drm analyze "https://.../index.m3u8" --json

# 2. Instalar infraestrutura (uma vez)
npm run mp4decrypt:install
npm run cdm:extract
pip install pywidevine
pywidevine create-device -k vendor/widevine-cdm/widevinecdm.dll -t "CHROME" -l 3 -o vendor/widevine-cdm/device.wvd

# 3. Download com bypass
node bin/streamgrab.mjs drm download "https://.../index.m3u8" `
  --license-url "https://.../license" `
  --referer "https://play.mercadolibre.com.br/" `
  --output "C:/Downloads"
```

---

## 4. Notas Técnicas

- **Formato do challenge:** o wrapper `src/drm/pywidevine-wrapper.js` tenta JSON `{"challenge": base64}` por padrão; use `--raw-body` se o license server esperar body bruto (padrão do Mercado Play segundo a heurística em `src/drm/mercado-play.js`).
- **Variação de QUALIDADE:** se o master tiver múltiplas variantes, cada uma pode ter o mesmo DRM — a licença costuma valer para todas.
- **Expiração:** URLs de segmento/playlist do mdstrm expiram rápido. Analise e baixe na mesma sessão.
