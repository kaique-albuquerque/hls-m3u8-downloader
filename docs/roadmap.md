# Roadmap do StreamGrab

> Fases públicas de evolução do StreamGrab (seção 36 do plano arquitetônico).
> O estado detalhado de cada parte está no `CHANGELOG.md`; decisões técnicas em
> `docs/architecture.md`.

## Fase A — Fundação ✅

- [x] Testes de caracterização (P0) — rede de segurança para refactors
- [x] Branding StreamGrab + SemVer 0.x (P1)
- [x] Core: modelos de domínio, taxonomia de erros, logger com redação de secrets,
      política de filenames, event bus (P2)
- [x] Providers normalizados: HLS, DASH, Direct, yt-dlp (P3)
- [x] Transports + seleção/fallback de estratégia + retries (P4)
- [x] FfmpegService central + áudio (remux/copy/transcode) (P5)

**Entregável:** testes, branding, core, providers, transports, FFmpeg central.

## Fase B — Produto Desktop ✅

- [x] Fila + Settings + Histórico + Persistência (P7)
- [x] Nova interface Electron + segurança (`contextIsolation`, `sandbox: true`) (P8)
- [x] Instalador Windows (`StreamGrab-Setup-<versão>.exe`) + CI/Releases essencial (P10)

**Entregável:** fila/settings/histórico, nova UI, installer Windows.

## Fase C — Download Management ✅

- [x] CLI evoluída: `streamgrab analyze <url>` / `streamgrab download <url>` (P9)
- [x] Resume para downloads compatíveis (HTTP Range/direct) (P6.1)

**Entregável:** CLI evoluída, resume.

## Fase D — Performance ✅

- [x] Smart Turbo orientado por benchmark (P6.2) — baseline em
      `tests/performance/BASELINE.md`; heurística nasce dos testes
      (rampa 2→4→8→12, backoff 0.5×, cooldown, rollback por config/flag)

**Entregável:** Smart Turbo com dados de baseline.

## Fase E — Maturidade 🚧

- [x] Docs de produto: README reescrito, CONTRIBUTING, roadmap (P11)
- [x] UX de falhas "Motivo / Ação sugerida / [Detalhes]" (P11, seção 42)
- [x] DRM: detecção Widevine/PlayReady/FairPlay → erro explícito (P11, seção 43)
- [x] Baseline de performance do core em `docs/performance.md` (P11, seção 49)
- [ ] Multi-plataforma: instaladores Linux (AppImage) e macOS (DMG)
- [ ] CI completo em tags: release notes automáticas, checksums (parcial já existe)
- [ ] Auto-update (somente após releases confiáveis e assinatura definida)
- [ ] Observabilidade: exportar log de diagnóstico
- [ ] Reavaliação de TypeScript (migração incremental separada, se aprovada)

**Entregável:** docs, segurança, DRM, baseline, refinamentos.

---

## Princípios

1. **Correção > Segurança > Testes > Arquitetura > Confiabilidade > UX >
   Distribuição > Performance > Novas features** (na ordem).
2. Migração incremental (strangler pattern) — nada de reescrita big-bang.
3. DRM: detecção clara, **nunca** bypass.
4. CLI e Electron compartilham o mesmo core.

> Nota: esta fase (E) está em andamento; o estado real de cada item é refletido
> pelo `CHANGELOG.md` — consulte-o para detalhes e datas.
