# StreamGrab — Plano de Melhorias (v2)

> Especificação de melhorias identificadas na auditoria do codebase em 2026-08-14.
> Alinhada com `STREAMGRAB_ARCHITECTURE_PLAN.md`, `docs/architecture.md` e `docs/roadmap.md`.
>
> **Status: TODOS OS SPRINTS CONCLUÍDOS (1+2+3+4+5). 308 testes passando.**

---

## 0. Princípios

1. **Strangler pattern** — nada de reescrita big-bang; cada melhoria é aditiva e testável.
2. **STOP após cada sprint** — relatório de 12 itens + aprovação explícita.
3. **Correção > Segurança > Testes > Arquitetura** — segue a ordem do roadmap.
4. **Sem quebrar CLI nem Electron** — mudanças internas, contratos públicos preservados.
5. **Cada sprint é autocontida** — pode ser mergeada independentemente.

---

## 1. Sprint 1 — Estabilidade (Correção de Bugs Críticos)

### 1.1 `killAllCurl()` é global — perigo de concorrência

**Problema:** `CurlImpersonateTransport.kill()` e `dispose()` chamam `killAllCurl()`, que mata **todos** os processos curl-impersonate do sistema. Se houver múltiplas instâncias do engine (CLI + Electron simultâneo, ou testes), uma mata a outra.

**Arquivos alterados:**
- `src/curlimp.js` — exportar nova função `killCurlByPid(pid)` ou `killCurlGroup(group)`
- `src/transports/curl.js` — `CurlImpersonateTransport` passa a rastrear PIDs por instância

**Implementação:**
```
CurlImpersonateTransport ganha:
  - this._pids = new Set()        // PIDs dos processos filhos
  - _trackChild(child)            // registra pid no spawn
  - kill()                        // mata apenas this._pids
  - dispose()                     // mata apenas this._pids
  - killAll() (estático)          // mantido para cleanup global (shutdown)
```

`killAllCurl()` permanece disponível mas **renomeado** para `killAllCurlProcesses()` e marcado como `@deprecated` — usado apenas no `dispose()` global do engine e no shutdown do Electron.

**Critérios de aceitação:**
- [ ] `kill()` de uma instância não afeta outra instância concorrente
- [ ] `dispose()` global ainda funciona (shutdown limpo)
- [ ] Teste: criar 2 transports, matar um, o outro continua funcionando
- [ ] Teste: `killAll()` ainda mata todos (para shutdown)

**Complexidade:** Média | **Risco:** Baixo

---

### 1.2 Job ID collision após crash recovery

**Problema:** `jobSequence` em `src/core/models.js` e `historySequence` em `src/core/history.js` são contadores módulo-global que resetam no restart. Um job restaurado de `queue.json` com id `job-5` colide com um novo job `job-5` criado pelo engine.

**Arquivos alterados:**
- `src/core/models.js` — `createDownloadJob()` aceita `id` externo; sequence só gera IDs para jobs **novos** (sem id fornecido)
- `src/core/queue.js` — ao restaurar jobs do disco, preserva o `id` original e atualiza `_id` do engine para `max(restoredIds) + 1`

**Implementação:**
```
DownloadEngine._nextId():
  // Garante que o próximo ID nunca colide com IDs restaurados
  this._id += 1;
  return `job-${this._id}`;

DownloadEngine._restoreJob(job):
  // Ao restaurar, ajusta o sequence para não colidir
  const num = Number(job.id?.replace('job-', '')) || 0;
  if (num >= this._id) this._id = num + 1;
```

**Alternativa mais robusta (recomendada):** Usar IDs no formato `job-<timestamp>-<random>` para jobs novos, eliminando completamente a chance de colição:
```js
_nextId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

**Critérios de aceitação:**
- [ ] Após crash + restore de `queue.json`, nenhum ID colide
- [ ] Jobs restaurados mantêm seus IDs originais
- [ ] Teste: simular restore com IDs `job-1`, `job-2`, criar novo → `job-3+`
- [ ] Teste: sequence não reseta em novo `DownloadEngine()`

**Complexidade:** Baixa | **Risco:** Baixo

---

### 1.3 Logs de diagnóstico temporários no engine

**Problema:** 6 chamadas `onLog()` no `createDefaultExecutor.run()` com prefixo `[mdstrm/roteamento]` — código temporário que ficou em produção.

**Arquivos alterados:**
- `src/core/engine.js` — remover ou portar para gate de debug

**Implementação:**
```js
// Opção A: remover (recomendado — o diagnóstico cumpriu seu papel)
// Simplesmente deletar as 6 linhas onLog() e o bloco TODO

// Opção B: gatear por variável de ambiente (se quiser manter)
const DEBUG_MDSTRM = process.env.SG_DEBUG_MDSTRM === '1';
if (DEBUG_MDSTRM) onLog(`[mdstrm/roteamento] ...`);
```

**Critérios de aceitação:**
- [ ] Nenhum log `[mdstrm/roteamento]` aparece em produção
- [ ] Com `SG_DEBUG_MDSTRM=1`, logs aparecem (se opção B)
- [ ] Fluxo de download mdstrm continua funcionando igual
- [ ] Testes existentes continuam passando

**Complexidade:** Baixa | **Risco:** Baixo

---

### 1.4 Queue `_pump()` race condition

**Problema:** `_pump()` usa flag `_draining` para dedup, mas chamadas concurrentes são silenciosamente dropadas. Se um job completa enquanto `_pump` está no `try/finally`, jobs enfileirados naquela janela podem não ser processados até o próximo evento.

**Arquivos alterados:**
- `src/core/queue.js` — usar `queueMicrotask` para garantir processamento

**Implementação:**
```js
let _pumpScheduled = false;

function _pump() {
  if (_pumpScheduled) return;
  _pumpScheduled = true;
  queueMicrotask(async () => {
    _pumpScheduled = false;
    // ... lógica atual de drain
  });
}
```

**Critérios de aceitação:**
- [ ] Jobs enfileirados durante um `drain` são processados na próxima microtask
- [ ] Não há pump concorrente (flag de dedup preservada)
- [ ] Teste: enqueue rápido de 10 jobs → todos completam
- [ ] Teste: enqueue durante download ativo → novo job é pego

**Complexidade:** Baixa | **Risco:** Baixo

---

## 2. Sprint 2 — Refatoração (Dedup e Decomposição)

### 2.1 Deduplicação do routing mdstrm

**Problema:** Lógica de routing mdstrm (detecção → curl-impersonate → fallback FFmpeg) duplicada em 3 arquivos:
- `src/core/engine.js` (~40 linhas no `createDefaultExecutor.run()`)
- `src/cli/curl-flow.js` (~30 linhas no `runCurlDownloadFlow`)
- `electron/main.js` (~20 linhas no `analyzePlaylist`)

Cada cópia tem tratamento de erro e fallback ligeiramente diferentes.

**Arquivos criados:**
- `src/core/mdstrm-routing.js` — módulo único de routing mdstrm

**Arquivos alterados:**
- `src/core/engine.js` — importa e delega para `mdstrm-routing.js`
- `src/cli/curl-flow.js` — importa e delega para `mdstrm-routing.js`
- `electron/main.js` — importa e delega para `mdstrm-routing.js`

**Contrato do módulo:**
```js
// src/core/mdstrm-routing.js

/**
 * Resolve a estratégia de download para uma URL mdstrm.
 * @param {{ url: string, jobUrl: string, headers: object, signal: AbortSignal,
 *            onProgress: fn, onLog: fn }} ctx
 * @returns {Promise<{ strategy: 'curl'|'ffmpeg', transport?: CurlImpersonateTransport,
 *           entryUrl: string, preferredVariantPath?: string } | null>}
 */
export async function resolveMdstrmStrategy(ctx) { ... }

/**
 * Roteamento completo: detecta mdstrm, resolve transporte, faz download.
 * Usado pelo engine como alternativa ao bloco inline.
 */
export async function executeMdstrmDownload(ctx) { ... }
```

**Critérios de aceitação:**
- [ ] Função `resolveMdstrmStrategy()` testável isoladamente (sem FFmpeg/curl reais)
- [ ] Engine, CLI e Electron usam o mesmo módulo
- [ ] Comportamento idêntico ao atual (regression test)
- [ ] Bloco TODO de diagnóstico removido (consolidado aqui se necessário)
- [ ] Testes unitários do módulo com mocks

**Complexidade:** Média | **Risco:** Médio (3 arquivos dependem disso)

---

### 2.2 Decomposição do `_runJob` no engine

**Problema:** `_runJob` tem ~200 linhas lidando com: análise, preparação, resolução de destino, verificação de disco, download (loop pausa/retoma), conclusão, classificação de erro, e registro de histórico.

**Arquivos alterados:**
- `src/core/engine.js` — extrair métodos privados

**Decomposição:**
```js
// Métodos extraídos de _runJob:
async _analyze(job, opts)              // ~30 linhas → adapter + analyze + fresh variant
async _prepare(job, opts)              // ~20 linhas → prepare + disk check + filename
async _downloadLoop(job, prepared, opts) // ~40 linhas → loop pausa/retoma
_complete(job)                          // ~10 linhas → transition + history + emit
_handleFailure(job, err)               // ~20 linhas → classify + cleanup + history + emit

// _runJob fica ~15 linhas:
async _runJob(job, opts) {
  try {
    const adapter = await this._analyze(job, opts);
    const prepared = await this._prepare(job, adapter, opts);
    await this._downloadLoop(job, prepared, opts);
    this._complete(job);
  } catch (err) {
    this._handleFailure(job, err);
  } finally {
    this._active.delete(job.id);
  }
}
```

**Critérios de aceitação:**
- [ ] `_runJob` tem < 30 linhas
- [ ] Cada método extraído é testável isoladamente
- [ ] Comportamento idêntico ao atual
- [ ] Todos os testes existentes continuam passando
- [ ] Nenhuma mudança na API pública do engine

**Complexidade:** Média | **Risco:** Baixo

---

### 2.3 Split de `utils.js`

**Problema:** `src/utils.js` tem 400+ linhas de utilitários não relacionados: normalização de URLs, detecção de hosts sociais, sanitização de filenames, formatação de bytes, normalização de headers, acesso a clipboard, probe de content-type, limpeza de markdown.

**Arquivos criados:**
- `src/core/url-utils.js` — `normalizeUrl`, `maskUrl`, `DEFAULT_USER_AGENT`
- `src/core/format-utils.js` — `formatBytes`, `formatDuration`
- `src/core/header-utils.js` — `normalizeHeaders`, `parseCookies`

**Arquivos alterados:**
- `src/utils.js` — re-exporta tudo (backward compat) + deprecation warnings
- Importadores migrados gradualmente (strangler)

**Contrato:**
```js
// src/core/url-utils.js
export function normalizeUrl(input) { ... }
export function maskUrl(url) { ... }
export const DEFAULT_USER_AGENT = '...';

// src/core/format-utils.js
export function formatBytes(bytes) { ... }
export function formatDuration(ms) { ... }

// src/core/header-utils.js
export function normalizeHeaders(raw) { ... }
export function parseCookies(header) { ... }

// src/utils.js (backward compat)
export { normalizeUrl, maskUrl, DEFAULT_USER_AGENT } from './core/url-utils.js';
export { formatBytes, formatDuration } from './core/format-utils.js';
export { normalizeHeaders, parseCookies } from './core/header-utils.js';
// ... resto mantido no utils.js original até migração completa
```

**Critérios de aceitação:**
- [ ] Imports existentes não quebram (re-exports em utils.js)
- [ ] Novos módulos testáveis isoladamente
- [ ] Testes existentes continuam passando
- [ ] Gradualmente, importadores migram para os módulos novos

**Complexidade:** Média | **Risco:** Baixo (re-exports garantem compat)

---

### 2.4 Split de `renderer.js` do Electron

**Problema:** `electron/renderer.js` é 700+ linhas de DOM manipulation sem módulos — tab management, event handling, progress rendering, theme toggling, settings panel, history panel, queue management, tudo em um arquivo.

**Arquivos criados:**
- `electron/renderer/tabs.js` — gerenciamento de abas
- `electron/renderer/progress.js` — renderização de progresso
- `electron/renderer/settings.js` — painel de configurações
- `electron/renderer/history.js` — painel de histórico
- `electron/renderer/queue.js` — gerenciamento de fila
- `electron/renderer/theme.js` — toggle de tema
- `electron/renderer/events.js` — binding de eventos IPC

**Arquivos alterados:**
- `electron/renderer.js` — importa dos módulos novos, orquestra inicialização

**Implementação:**
```js
// electron/renderer.js (novo, ~50 linhas)
import { initTabs } from './renderer/tabs.js';
import { initProgress } from './renderer/progress.js';
import { initSettings } from './renderer/settings.js';
import { initHistory } from './renderer/history.js';
import { initQueue } from './renderer/queue.js';
import { initTheme } from './renderer/theme.js';
import { bindEvents } from './renderer/events.js';

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initProgress();
  initSettings();
  initHistory();
  initQueue();
  initTheme();
  bindEvents();
});
```

**Nota:** Como o Electron não usa bundler, os módulos precisam ser carregados via `<script type="module">` ou inline. Verificar se o `index.html` suporta ESM. Se não, usar IIFE pattern ou adicionar esbuild leve.

**Critérios de aceitação:**
- [ ] Cada módulo é isolado e testável (pelo menos em browser context)
- [ ] Funcionalidade da UI preservada 100%
- [ ] Nenhum novo依赖 (mantém zero-dep philosophy)
- [ ] Performance da UI não degrada

**Complexidade:** Média-Alta | **Risco:** Médio (UI deve funcionar igual)

---

## 3. Sprint 3 — DX (Developer Experience)

### 3.1 ESLint mais rigoroso

**Problema:** `eslint.config.js` tem apenas 4 regras. Falta `no-console`, `prefer-const`, `complexity`, `max-lines-per-function`, `import/order`.

**Arquivos alterados:**
- `eslint.config.js` — adicionar regras
- Arquivos com violações — fix automáticos ou manuais

**Regras a adicionar:**
```js
rules: {
  // Existentes (manter)
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  'no-fallthrough': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],

  // Novas
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'prefer-const': 'error',
  'no-var': 'error',
  'prefer-template': 'warn',
  'complexity': ['warn', 20],
  'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
  'import/order': ['warn', {
    groups: ['builtin', 'external', 'internal', 'parent', 'sibling'],
    'newlines-between': 'always',
  }],
}
```

**Critérios de aceitação:**
- [ ] `npm run lint` passa sem erros (warnings aceitáveis)
- [ ] Nenhuma regra quebra código existente (fix automáticos primeiro)
- [ ] `no-console` previne logs acidentais em produção

**Complexidade:** Baixa | **Risco:** Baixo

---

### 3.2 `// @ts-check` + JSDoc types

**Problema:** O projeto é JS puro sem type checking. JSDoc documenta tipos mas nunca valida.

**Arquivos alterados:**
- `src/core/models.js` — adicionar `// @ts-check` no topo + tipos JSDoc completos
- `src/core/errors.js` — idem
- `src/core/engine.js` — idem

**Implementação:**
```js
// @ts-check

/**
 * @typedef {{ id: string, title: string, state: JobState, meta: JobMeta }} DownloadJob
 * @typedef {'queued'|'analyzing'|'preparing'|'downloading'|'paused'|'completed'|'failed'|'cancelled'} JobState
 */

/** @param {{ id?: string, url: string, title?: string }} input */
export function createDownloadJob({ id, url, title }) { ... }
```

**Critérios de aceitação:**
- [ ] `tsc --noEmit --allowJs --checkJs --target ES2022` passa sem erros nos arquivos marcados
- [ ] Tipos exportados são consumíveis por outros módulos
- [ ] Nenhuma mudança de runtime

**Complexidade:** Média | **Risco:** Baixo

---

### 3.3 Migração de idioma (comentários/strings)

**Problema:** Comentários e strings alternam entre PT e EN inconsistentemente.

**Decisão:** Manter **PT para mensagens ao usuário** (friendlyMessage, suggestedAction, error.message) e **EN para código/comentários**. Segue o padrão do `errors.js` que já faz isso.

**Arquivos alterados:**
- `src/core/engine.js` — traduzir comentários internos para EN
- `src/core/models.js` — idem
- `src/core/errors.js` — manter strings PT (já correto)
- Outros arquivos do core — revisar

**Critérios de aceitação:**
- [ ] Comentários do core em EN
- [ ] Mensagens de erro para usuário em PT (já é o caso)
- [ ] Identificadores sempre em EN (já é o caso)

**Complexidade:** Baixa | **Risco:** Baixo

---

## 4. Sprint 4 — Features (Funcionalidades Faltantes)

### 4.1 Export de logs diagnósticos

**Problema:** `logger.js` redige logs mas não persiste/exporta. Usuário não pode compartilhar diagnóstico.

**Arquivos criados:**
- `src/core/log-export.js` — exporta logs redigidos para arquivo `.txt`

**Arquivos alterados:**
- `src/core/logger.js` — mantém buffer circular em memória
- `electron/main.js` — handler IPC `export-logs` que salva buffer
- `electron/renderer.js` — botão "Exportar logs" no settings

**Contrato:**
```js
// src/core/log-export.js
export function exportLogs(entries, outputPath) { ... }
// Formato: timestamp | level | category | message (redacted)
```

**Critérios de aceitação:**
- [ ] Botão "Exportar logs" no settings do Electron
- [ ] Arquivo exportado contém logs redigidos (sem secrets)
- [ ] Últimas 1000 entradas preservadas (buffer circular)
- [ ] CLI: flag `--export-log <path>` exporta ao final da sessão

**Complexidade:** Média | **Risco:** Baixo

---

### 4.2 Circuit breaker no yt-dlp

**Problema:** `analyzeYtDlpUrl` retries 3x em spawn-block errors, mas sem proteção contra rate-limit repetido da plataforma (403/429).

**Arquivos alterados:**
- `src/adapters/ytdlp.js` — adicionar circuit breaker simples

**Implementação:**
```js
class CircuitBreaker {
  constructor({ threshold = 3, cooldownMs = 60_000 } = {}) {
    this._failures = 0;
    this._threshold = threshold;
    this._cooldownMs = cooldownMs;
    this._openedAt = 0;
  }
  isOpen() {
    if (this._failures < this._threshold) return false;
    if (Date.now() - this._openedAt > this._cooldownMs) {
      this._failures = 0; // half-open
      return false;
    }
    return true;
  }
  recordFailure() { this._failures++; this._openedAt = Date.now(); }
  recordSuccess() { this._failures = 0; }
}
```

**Critérios de aceitação:**
- [ ] Após 3 falhas 403/429 consecutivas, yt-dlp analysis retorna erro imediato por 60s
- [ ] Após cooldown, tenta novamente (half-open)
- [ ] Sucesso reseta o contador
- [ ] Teste: simular 3 failures → breaker open → wait → half-open → success → closed

**Complexidade:** Baixa | **Risco:** Baixo

---

### 4.3 Dual config → migração para `settings.json`

**Problema:** `config.json` (legacy) + `streamgrab.settings.json` coexistem com merge hardcodado.

**Arquivos alterados:**
- `src/cli/config.js` — deprecar `mergeConfigWithSettings()`, log de warning quando `config.json` é detectado
- `src/core/settings.js` — unificar schema

**Implementação:**
```js
// Na primeira detecção de config.json:
if (fs.existsSync(configPath)) {
  logger.warn('[config] config.json detectado — migrando para streamgrab.settings.json');
  const legacy = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  settings.merge(legacy); // escrita atômica em settings.json
  fs.renameSync(configPath, configPath + '.deprecated'); // não deleta, só renomeia
}
```

**Critérios de aceitação:**
- [ ] Settings existentes são preservados na migração
- [ ] `config.json` renomeado para `.deprecated` (não deletado)
- [ ] Warning visível no console/CLI
- [ ] Novas settings só existem em `settings.json`

**Complexidade:** Baixa | **Risco:** Baixo

---

### 4.4 Progress persistence para HLS/DASH

**Problema:** Crash durante FFmpeg download (HLS/DASH) perde progresso. O resume.js só cobre HTTP Range/direct.

**Decisão (ADR-005 mantida):** HLS/DASH resume via re-execução do FFmpeg — não implementar resume granular por segmento. Porém, podemos persistir **metadados** do download (URL, qualidade, bytes estimados) para permitir re-submissão automática.

**Arquivos alterados:**
- `src/core/engine.js` — ao detectar crash recovery (job em `downloading` no restore), re-submitir download
- `src/core/queue.js` — ao restaurar jobs em `downloading`, transicionar para `queued` (comportamento atual) + registrar metadados para re-análise

**Critérios de aceitação:**
- [ ] Após crash, jobs HLS/DASH aparecem como `queued` na fila (já é o caso)
- [ ] Re-submissão usa tokens frescos (re-análise automática)
- [ ] Usuário pode re-iniciar manualmente

**Complexidade:** Baixa | **Risco:** Baixo

---

## 5. Sprint 5 — Qualidade (Testes e Segurança)

### 5.1 Testes faltando — priorização

| Caminho | Prioridade | Tipo | Complexidade |
|---------|-----------|------|-------------|
| `electron/main.js` IPC handlers | Alta | Integration | Média |
| Pipeline completo analyze→download→complete | Alta | Integration | Alta |
| `cli/curl-flow.js` routing | Média | Unit + Integration | Média |
| `src/curlimp.js` | Média | Unit | Baixa |
| `renderer.js` event handling | Baixa | E2E | Alta |

**Implementação por prioridade:**

**5.1.1 `curlimp.js` testes unitários:**
```
tests/unit/curlimp.test.js
  - resolve() retorna null quando não instalado
  - resolve() retorna transport quando instalado
  - kill() mata apenas processos da instância (não global)
```

**5.1.2 IPC handlers (integration):**
```
tests/integration/ipc-handlers.test.js
  - analyze: valida URL, retorna MediaInfo
  - download: valida taskId, retorna job
  - cancel: interrompe download
  - open-file: valida path contra roots registrados
```

**5.1.3 Pipeline completo:**
```
tests/integration/pipeline.test.js
  - analyze → prepare → download → complete (mock executor)
  - Pausa durante download → resume → complete
  - Erro durante download → failed + cleanup
  - Cancelamento durante download → cancelled + cleanup
```

**Critérios de aceitação:**
- [ ] `npm test` passa com todos os testes novos
- [ ] Cobertura do engine: ≥ 80% (linhas)
- [ ] Cobertura do curlimp: ≥ 70%

---

### 5.2 CI security audit

**Problema:** Sem `npm audit` ou dependency scanning. `youtube-dl-exec` baixa binários em install (supply chain risk).

**Arquivos alterados:**
- `package.json` — adicionar script `audit`
- `.github/workflows/` (se existir) — adicionar step de audit

**Script:**
```json
{
  "scripts": {
    "audit": "npm audit --omit=dev || echo 'Audit issues found — review above'"
  }
}
```

**Critérios de aceitação:**
- [ ] `npm run audit` roda sem erro (warnings aceitáveis)
- [ ] Nenhuma vulnerabilidade CRITICAL/HIGH

---

## 6. Resumo por Sprint

| Sprint | Tema | Itens | Complexidade | Depende de |
|--------|------|-------|-------------|-----------|
| **1** | Estabilidade | 1.1–1.4 | Baixa–Média | Nada |
| **2** | Refatoração | 2.1–2.4 | Média–Alta | Sprint 1 |
| **3** | DX | 3.1–3.3 | Baixa–Média | Sprint 2 |
| **4** | Features | 4.1–4.4 | Média | Sprint 2 |
| **5** | Qualidade | 5.1–5.2 | Média–Alta | Sprint 1+2 |

---

## 7. Mapa de Dependências

```
Sprint 1 (estabilidade)
  ├─ 1.1 killAllCurl per-instance ──────────────┐
  ├─ 1.2 job ID collision ──────────────────────┤
  ├─ 1.3 TODO logs ─────────────────────────────┤
  └─ 1.4 queue pump race ───────────────────────┤
                                                 │
Sprint 2 (refatoração) ←────── precisa de Sprint 1 estável
  ├─ 2.1 mdstrm routing dedup ──────────────────┤
  ├─ 2.2 _runJob decomposition ─────────────────┤
  ├─ 2.3 utils.js split ────────────────────────┤
  └─ 2.4 renderer.js split ─────────────────────┤
                                                 │
Sprint 3 (DX) ←────── pode rodar paralelo ao 4  │
  ├─ 3.1 ESLint upgrade ────────────────────────┤
  ├─ 3.2 @ts-check ─────────────────────────────┤
  └─ 3.3 Idioma migration ──────────────────────┤
                                                 │
Sprint 4 (features) ←────── pode rodar paralelo ao 3
  ├─ 4.1 log export ────────────────────────────┤
  ├─ 4.2 circuit breaker yt-dlp ────────────────┤
  ├─ 4.3 config migration ──────────────────────┤
  └─ 4.4 HLS/DASH crash recovery ───────────────┤
                                                 │
Sprint 5 (qualidade) ←────── pode rodar paralelo ao 3+4
  ├─ 5.1 missing tests ─────────────────────────┤
  └─ 5.2 CI security audit ─────────────────────┘
```

---

## 8. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Sprint 2.4 (renderer split) quebra UI | Alto | Testar manualmente cada aba; manter `renderer.js` original como backup |
| Sprint 2.1 (mdstrm dedup) altera comportamento | Alto | Regression test com URLs mdstrm reais; comparar logs antes/depois |
| Sprint 3.1 (ESLint) gera muitos warnings | Baixo | Fix automáticos primeiro; warnings restantes documentados |
| Sprint 4.4 (HLS crash recovery) não funciona | Baixo | Já é comportamento existente (jobs viram queued); melhorar só UX |
| Sprint 1.1 (killAllCurl) introduz memory leak | Médio | Garantir que `dispose()` da instância limpa Set de PIDs |

---

## 9. Cronograma Estimado

| Sprint | Estimativa | Entregável |
|--------|-----------|-----------|
| Sprint 1 | 2–3 dias | Bugs críticos corrigidos |
| Sprint 2 | 4–5 dias | Código deduplicado e decomposto |
| Sprint 3 | 2–3 dias | DX melhorado |
| Sprint 4 | 3–4 dias | Features novas |
| Sprint 5 | 3–4 dias | Testes + CI |
| **Total** | **14–19 dias** | Codebase significativamente mais saudável |
