# Plano de Atualizacao: DRM Mercado Play

**Data:** 2026-08-18
**Base:** revisao do codigo atual + `plan/plan-drm-mercado-play.md` + `plan/drm-mercado-play-recon.md`
**Objetivo:** alinhar o plano com o que ja existe no repositorio e definir os proximos passos para sair do estado "experimental" e chegar em um fluxo confiavel.

---

## 1. Resumo Executivo

O projeto ja possui a maior parte da infraestrutura e da implementacao central de DRM:

- handler Widevine funcional
- handler especifico do Mercado Play
- registry DRM com `runDRMPipeline`
- scripts para `mp4decrypt` e extracao do CDM
- CLI `streamgrab drm analyze` e `streamgrab drm download`
- cobertura unitária relevante

Os gargalos atuais nao estao mais na base tecnica principal, e sim em quatro pontos:

1. concluir a infraestrutura local (`mp4decrypt` + `device.wvd` ou uso consistente de `--keys`)
2. integrar o fluxo DRM ao download normal do provider/engine
3. validar o pipeline com um caso real end-to-end
4. atualizar a documentacao para refletir o estado verdadeiro do projeto

---

## 2. Estado Atual Real

### Implementado

- `src/drm/widevine.js`
- `src/drm/mercado-play.js`
- `src/drm/registry.js`
- `src/drm/pywidevine-wrapper.js`
- `src/core/binaries.js`
- `scripts/install-mp4decrypt.mjs`
- `scripts/install-widevine-cdm.mjs`
- provider Mercado Play com anotacao de `media.drm`
- comandos CLI DRM com suporte a `--license-url` e `--keys`

### Parcial

- reconhecimento do license flow ainda incompleto em nivel de headers/body reais
- integracao do DRM com o fluxo normal de download
- testes de integracao com stream real
- documentacao principal ainda mistura plano antigo com estado novo

### Faltando

- fluxo automatico no engine para decrypt pos-download
- validacao end-to-end reproduzivel
- fechamento da estrategia oficial para `device.wvd`
- expansao para outros DRMs/servicos

---

## 3. Objetivos da Atualizacao

### Objetivo A: Fechar o caminho pratico de uso

Permitir que o projeto seja utilizavel hoje, mesmo que temporariamente pelo caminho de chaves manuais (`--keys`), sem depender de partes ainda incertas do pywidevine.

### Objetivo B: Reduzir a divergencia entre plano e codigo

Atualizar os documentos para que eles descrevam o que realmente existe, evitando retrabalho e falsa sensacao de pendencia em itens ja implementados.

### Objetivo C: Preparar a integracao definitiva

Levar o pipeline DRM do modo "comando separado" para o fluxo normal do provider/engine quando houver DRM detectado.

---

## 4. Fases de Atualizacao

### Fase U1 - Saneamento do plano e da documentacao

**Objetivo:** consolidar a verdade atual do projeto.

#### Tarefas

- [ ] Atualizar `plan/plan-drm-mercado-play.md` para marcar itens realmente implementados
- [ ] Ajustar o status da Fase 2 para "implementada via CLI DRM separada"
- [ ] Ajustar o status da Fase 3 para "unitarios concluidos, integracao real pendente"
- [ ] Revisar `plan/drm-mercado-play-recon.md` e preencher o que ja e conhecido
- [ ] Adicionar uma secao "caminho recomendado hoje" baseada em `streamgrab drm download --keys`

#### Criterio de saida

- qualquer pessoa lendo os arquivos de `plan/` entende claramente o que esta pronto, o que esta parcial e qual e o fluxo recomendado hoje

---

### Fase U2 - Fechar a infraestrutura minima

**Objetivo:** garantir que o repositorio consiga rodar o caminho atual sem improviso.

#### Tarefas

- [ ] Instalar e validar `mp4decrypt` com `npm run mp4decrypt:install`
- [ ] Confirmar se `vendor/widevine-cdm/widevinecdm.dll` continua presente e documentado
- [ ] Decidir a estrategia oficial para curto prazo:
  - [ ] caminho A: exigir `--keys` como fluxo recomendado
  - [ ] caminho B: obter `device.wvd` valido e liberar `pywidevine`
- [ ] Se o caminho A for o oficial por enquanto, explicitar isso no help e na documentacao
- [ ] Se o caminho B for viavel, documentar o processo completo e testar `acquireLicense()`

#### Criterio de saida

- existe pelo menos um caminho suportado e documentado que funcione do inicio ao fim

---

### Fase U3 - Integrar DRM ao fluxo normal de download

**Objetivo:** remover a separacao artificial entre "download normal" e "download DRM".

#### Tarefas

- [ ] Evoluir `src/providers/mercadoplay/index.js` para devolver `drm` e um `postProcess` quando houver protecao
- [ ] Definir contrato de `PreparedDownload` para suportar post-processamento
- [ ] Atualizar `src/core/engine.js` para:
  - [ ] baixar o arquivo criptografado
  - [ ] detectar quando existe `postProcess`
  - [ ] executar a descriptografia antes de concluir o job
- [ ] Garantir que erros DRM aparecam com mensagens claras no fluxo normal
- [ ] Preservar o comando `streamgrab drm download` como caminho de diagnostico/manual

#### Criterio de saida

- uma URL do Mercado Play com DRM pode seguir pelo fluxo de download principal sem precisar chamar um subcomando separado

---

### Fase U4 - Teste end-to-end real

**Objetivo:** provar que o pipeline funciona fora dos mocks.

#### Tarefas

- [ ] Selecionar um video gratuito e estavel do Mercado Play
- [ ] Salvar URL de teste e observacoes operacionais
- [ ] Rodar `streamgrab drm analyze` e registrar o resultado
- [ ] Rodar `streamgrab drm download` com o caminho suportado atual:
  - [ ] com `--keys`, ou
  - [ ] com `--license-url` + `device.wvd`
- [ ] Confirmar que o arquivo final e reproduzivel
- [ ] Testar ao menos um caso de falha esperada:
  - [ ] sem `mp4decrypt`
  - [ ] sem chaves/licenca
  - [ ] headers insuficientes

#### Criterio de saida

- existe uma execucao real comprovada e documentada, com resultado final verificavel

---

### Fase U5 - Cobertura de testes e robustez

**Objetivo:** transformar a implementacao atual em algo mais resistente a regressao.

#### Tarefas

- [ ] Adicionar testes para o contrato de integracao entre provider e engine
- [ ] Adicionar testes para o caminho `postProcess` no engine
- [ ] Adicionar teste do CLI `drm download` com mocks do pipeline
- [ ] Adicionar teste para o caso "DRM detectado no provider, mas fluxo normal segue sem decrypt"
- [ ] Cobrir melhor erros de infraestrutura e mensagens de orientacao ao usuario

#### Criterio de saida

- regressões de integração DRM sao detectadas por testes automatizados antes de chegar ao uso manual

---

### Fase U6 - Limpeza arquitetural

**Objetivo:** deixar a base preparada para expansao futura sem carregar ambiguidade tecnica.

#### Tarefas

- [ ] Decidir o papel futuro de `src/drm/downloader.js`:
  - [ ] remover stubs antigos, ou
  - [ ] transformar em fachada real sobre `registry.js`
- [ ] Avaliar criacao de `src/drm/generic-widevine.js`
- [ ] Padronizar nomes e responsabilidades entre `handler`, `registry` e `pipeline`
- [ ] Eliminar comentarios/documentos que ainda descrevem etapas ja superadas

#### Criterio de saida

- a arquitetura DRM fica mais simples de entender e com menos duplicacao conceitual

---

## 5. Ordem Recomendada

Executar nesta sequencia:

1. Fase U1 - documentacao
2. Fase U2 - infraestrutura minima
3. Fase U4 - prova real do caminho atual
4. Fase U3 - integracao com fluxo normal
5. Fase U5 - testes de integracao
6. Fase U6 - limpeza arquitetural

Motivo:

- primeiro alinhamos a verdade do projeto
- depois garantimos um caminho pratico funcionando
- so entao investimos em integrar e consolidar

---

## 6. Backlog Priorizado

### Prioridade alta

- [ ] instalar `mp4decrypt`
- [ ] definir se o fluxo oficial de curto prazo sera `--keys`
- [ ] validar um video real do Mercado Play
- [ ] atualizar `plan/plan-drm-mercado-play.md`

### Prioridade media

- [ ] integrar `postProcess` DRM no provider/engine
- [ ] ampliar testes de integracao
- [ ] revisar `src/drm/downloader.js`

### Prioridade baixa

- [ ] preparar abstracao para outros servicos
- [ ] adicionar handlers futuros

---

## 7. Riscos

- o caminho com `device.wvd` pode continuar bloqueado por mudancas no ecossistema Widevine
- URLs do Mercado Play podem expirar rapido e dificultar reproducao
- integrar DRM ao engine pode exigir ajuste no contrato de download preparado
- o fluxo atual por `--keys` pode ser o unico viavel por algum tempo

---

## 8. Definicao de Sucesso

Considerar esta atualizacao concluida quando:

- a documentacao refletir corretamente o estado atual
- existir um fluxo suportado e testado para baixar e descriptografar um video real
- o caminho normal de download souber lidar com DRM do Mercado Play
- os testes cobrirem a integracao principal sem depender apenas de mocks unitarios

---

## 9. Proximo Passo Imediato

Se for para executar em cima deste plano, a melhor sequencia inicial e:

1. atualizar `plan/plan-drm-mercado-play.md`
2. instalar `mp4decrypt`
3. decidir se vamos oficializar `--keys` como caminho de curto prazo
4. rodar um teste real com um video gratuito

