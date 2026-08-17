# Guia: Captura de Chaves Widevine com WidevineProxy2 (Mercado Play)

> **Status:** ✅ FUNCIONANDO! (2026-08-17 — 2 vídeos baixados: Homem-Aranha e CSI Miami)
> **Data:** 2026-08-17

---

## 🏆 SUCESSO! O fluxo completo que funciona

### Resultados obtidos (2026-08-17)

| Vídeo | Qualidade | Resultado |
|-------|-----------|-----------|
| Homem-Aranha: De Volta ao Lar (filme) | 720p | ✅ Baixado (2h13min) |
| CSI Miami (episódio) | 480p | ✅ Baixado (44min) + áudio PT |

### ✅ SOLUÇÃO FINAL: Remote CDM do getwvkeys + MPD filtrado

O segredo do sucesso foi combinar:

1. **WidevineProxy2 com Remote CDM do getwvkeys** (`tools/widevine-proxy2/remote.json`)
   - Config pública: `https://getwvkeys.cc/api/remotecdm/widevine` (secret `getwvkeys`)
   - Captura as chaves KID:KEY direto no navegador ao reproduzir o vídeo

2. **Filtrar o MPD** para remover trilhas sem chave (CRÍTICO!):
   - Os vídeos do Mercado Play têm **várias trilhas por período**: vídeo 720p (KID A), vídeo alternativo (KID B sem chave), áudios (KID C), legendas
   - Remova os AdaptationSets com KIDs que você **não** capturou
   - Use o script `tools/filter-mpd.mjs` (gera o MPD filtrado localmente)

3. **N_m3u8DL-RE** baixa e descriptografa com as chaves que temos
   ```
   N_m3u8DL-RE.exe "<MPD_FILTRADO>" --key "KID1:KEY1" --key "KID2:KEY2" -sv best -sa lang=pt -M format=mp4
   ```

4. **FFmpeg** muxa vídeo + áudio em um MP4 único
   ```
   ffmpeg -i video.mp4 -i audio.pt.m4a -c copy -movflags +faststart final.mp4
   ```

---

### ✅ Comando automático (1 linha!)

Criei um script que faz **tudo** (filtrar MPD → baixar → descriptografar → muxar):

```bash
# npm run drm:mercado-play -- "<URL_MPD>" "KID1:KEY1" "KID2:KEY2" [--audio pt] [--name nome]
npm run drm:mercado-play -- "https://.../index.mpd" \
  "5dc26456869637ca80bd0da7997b18c5:de600a57dde164ccf1e6d43bb55632d8" \
  "28e95d7a9c413396af96abde8d8570e9:bf2fe6c945f8913c1c9f5690cc58956d" \
  --audio pt --name csi-miami
```

### 🐣 Comando INTERATIVO (mais fácil — não precisa decorar nada!)

**Só rode e o programa pergunta tudo, passo a passo:**

```bash
npm run drm:mp
```

O programa vai:
1. Pedir o **link do MPD** (cole o que copiou no navegador)
2. Pedir as **chaves uma por uma** (cole cada `KID:KEY`, aperte Enter vazio quando terminar)
3. Perguntar o **idioma do áudio** (padrão: pt)
4. Perguntar se quer **baixar legendas** (💬 s/N) e o idioma (padrão: pt)
5. Perguntar o **nome do arquivo** (padrão: mercadoplay)
6. Mostrar um **resumo** e pedir confirmação
7. Baixar, descriptografar e muxar automaticamente (vídeo + áudio + legendas)
8. Entregar o MP4 final em `Downloads\nome.mp4`

**No script automático** (1 linha), a opção de legenda é `--subs <lang>`:
```bash
npm run drm:mercado-play -- "<URL_MPD>" "KID1:KEY1" "KID2:KEY2" --audio pt --subs pt --name filme
```

**O que copiar do navegador (WidevineProxy2):**
1. **`Manifest DASH → copy`** → link do MPD (cole no passo 1)
2. **`Keys → copy`** → chaves (cole no passo 2, uma por vez)

> ⚠️ **Atenção:** a URL do MPD **expira rápido** (minutos). Pegue a URL e rode o comando logo em seguida.

### ❌ Erro comum: "Nenhum arquivo de vídeo foi gerado"

Isso acontece quando as chaves coladas **não cobrem o vídeo** (só o áudio). O vídeo tem um KID **diferente** do áudio.

**Como identificar a chave certa do vídeo:**

1. No popup do WidevineProxy2, clique em **History** (junto de "Keys past 5 min")
2. Cada entrada tem um **PSSH** e **Keys** — identifique a que corresponde a **este vídeo**
3. Copie **TODAS as chaves** da entrada deste vídeo (não de outros vídeos/anúncios)
4. Se o MPD tem o KID `5dc26456...` para o vídeo, essa chave **precisa** estar na lista

> 💡 O script agora mostra um diagnóstico quando isso acontece:
> - `KIDs do MPD: ...` (todos os KIDs que o vídeo usa)
> - `KIDs que você tem: ...`
> - `KIDs SEM chave: ...` (é a chave que falta — geralmente a do vídeo)

---

## 📊 Histórico do teste (device 4464 — REVOGADO)

| Item | Resultado |
|------|-----------|
| Extensão WidevineProxy2 v1.2.3 | ✅ Instalada e interceptando (vídeo trava com ela ativa = funciona) |
| Device `android_generic` (Nexus 6, System ID 4464) | ❌ **Revogado** — vídeo não carrega com ele ativo; teste pywidevine deu HTTP 400/403 |
| Diagnóstico | A extensão gera o challenge, mas o DRMtoday rejeita o device vazado → player espera licença eternamente |
| **Solução** | **Remote CDM do getwvkeys** (sem device próprio!) |

> 💡 **Confirmação:** com a extensão DESATIVADA o vídeo toca normal (usa CDM do
> Chrome); com ela ATIVADA trava — prova que a extensão substitui o challenge,
> mas o device 4464 é rejeitado pelo license server.

---

## ⚠️ IMPORTANTE — Leia antes

O WidevineProxy2 **NÃO funciona sem um device `.wvd`** OU **Remote CDM**. A
solução que funcionou foi o **Remote CDM gratuito do getwvkeys** (sem device
próprio).

O CDM do Chrome 148 que você extraiu **não serve** (CDMs modernos são
criptografados; não há ferramenta pública que extraia a chave deles).

---

## Passo 1 — Instalar a extensão no Chrome

1. Abra o Chrome e navegue para `chrome://extensions/`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação** (Load unpacked)
4. Selecione a pasta:
   ```
   C:\streamgrab\tools\widevine-proxy2\ext
   ```
5. A extensão **WidevineProxy2** deve aparecer na lista

---

## Passo 2 — Obter um device `.wvd` (o gargalo)

Escolha **um** dos caminhos:

### Opção A — Device do SEU próprio Android ⭐ (mais garantido)

Um device extraído do **seu** aparelho nunca é revogado. **KeyDive já está
instalado na sua máquina (3.0.6).**

**Requisitos:**
- Um celular Android com **ROOT** (ou Shizuku) + USB debugging ativo
- frida-server no aparelho (KeyDive instala via ADB)

**Passos:**
1. Conecte o Android via USB com **USB debugging** ativado:
   - Configurações → Sobre o telefone → toque 7x em "Número da versão"
   - Configurações → Opções do desenvolvedor → **USB debugging** ON
2. Confirme que o ADB enxerga o aparelho: `adb devices`
3. Extraia as chaves (gera `client_id.bin` + `private_key.pem` + `.wvd`):
   ```bash
   python -m keydive -kw -a player
   ```
   (`-w` = exporta WVD, `-k` = keybox, `-a player` = app de teste DRM)
4. Copie o `device.wvd` gerado para `C:\streamgrab\vendor\widevine-cdm\device.wvd`
5. Carregue na extensão (popup → Choose File)

> 💡 O KeyDive instala o app Kaltura DRM test e extrai automaticamente durante
> a reprodução de teste. Se o aparelho tiver L1 (Xiaomi etc.), talvez precise
> do módulo liboemcrypto-disabler (Magisk) — ver docs do KeyDive.

### Opção B — Device pronto da comunidade

1. Acesse o fórum **VideoHelp** (seção "Widevine" / "DRM"):
   - https://forum.videohelp.com/forums/48
   - Tópico oficial: https://forum.videohelp.com/threads/408031
2. Procure por devices L3 **recentes** (posts novos — devices antigos estão revogados)
3. Baixe o `.wvd` e salve em `C:\streamgrab\vendor\widevine-cdm\device.wvd`

> ⚠️ O VideoHelp estava fora do ar em 17/08/2026 — tente de novo mais tarde.

### Opção C — Remote CDM

O WVP2 suporta `remote.json` apontando para um serviço remoto com device válido
(se você conhecer/conseguir um).

---

## Passo 3 — Carregar o device na extensão

1. Clique no ícone da **WidevineProxy2** na barra do Chrome
2. No popup, escolha **Local Widevine device**
3. Clique em **+ Choose File** → selecione:
   ```
   C:\streamgrab\vendor\widevine-cdm\device.wvd
   ```

---

## Passo 4 — Capturar as chaves

1. Abra o **Mercado Play** e reproduza o vídeo (deixe em play)
2. A extensão intercepta o challenge/licença automaticamente
3. Clique no ícone da extensão → a seção **Keys** mostra as chaves recentes
4. Copie as chaves no formato:
   ```
   KID:KEY
   ```
   Exemplo:
   ```
   0123456789abcdef0123456789abcdef:00112233445566778899aabbccddeeff
   ```

---

## Passo 5 — Usar as chaves com o StreamGrab

```bash
# Com o stream criptografado já baixado:
node bin/streamgrab.mjs drm download "<URL_DO_MPD>" `
  --keys "0123456789abcdef0123456789abcdef:00112233445566778899aabbccddeeff" `
  --output "C:/Downloads"

# O pipeline: baixa o stream (FFmpeg -c copy) → descriptografa (mp4decrypt)
```

### Ou se já tiver o arquivo criptografado (.encrypted.mp4):

```bash
node bin/streamgrab.mjs drm download "<URL_DO_MPD>" `
  --keys "KID:KEY" `
  --no-download `
  --output "C:/Downloads"
```

---

## Troubleshooting

| Problema | Solução |
|----------|---------|
| Extensão não carrega no Chrome | Reinstale em `chrome://extensions/` (Modo desenvolvedor) |
| "No device found" no popup | Device `.wvd` ausente ou formato errado (deve ser WVD v1/v2) |
| Nenhuma chave aparece | O vídeo não usa Widevine, ou o site bloqueia o device (revogado). Teste com outro device |
| License endpoint rejeita | Alguns sites só aceitam CDM Android — use device tipo ANDROID |
| Chaves expiram | URLs do mdstrm expiram em minutos — baixe logo após capturar |

---

## Nota Legal

Uso **apenas para fins educacionais/pessoais** em conteúdo que você tem direito
de acessar. Não distribua devices ou conteúdo descriptografado.
