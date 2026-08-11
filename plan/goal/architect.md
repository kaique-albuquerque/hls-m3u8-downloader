# STREAMGRAB — SPEC DE EVOLUÇÃO E PLANO ARQUITETÔNICO

## INSTRUÇÃO PRINCIPAL AO AGENTE

Você está trabalhando no projeto StreamGrab.

IMPORTANTE: NÃO implemente nenhuma das mudanças descritas neste documento imediatamente.

Sua primeira tarefa é exclusivamente:

1. Analisar profundamente o repositório atual.
2. Entender a arquitetura existente e os fluxos completos de download.
3. Identificar dependências, acoplamentos, código legado, riscos e possíveis regressões.
4. Comparar a arquitetura atual com os objetivos desta especificação.
5. Criar um PLANO ARQUITETÔNICO detalhado.
6. Criar uma SPEC TÉCNICA detalhada da implementação proposta.
7. Dividir a implementação em fases pequenas, testáveis e reversíveis.
8. Explicar quais arquivos seriam criados, alterados, movidos ou removidos.
9. Identificar migrações e compatibilidade necessária.
10. Definir testes e critérios de aceitação para cada fase.
11. Apresentar o plano ao usuário e PARAR.

NÃO altere arquivos.
NÃO faça refactors.
NÃO instale dependências.
NÃO altere package.json.
NÃO crie commits.
NÃO renomeie arquivos.
NÃO remova código legado.
NÃO implemente nenhuma feature.

Depois de apresentar o plano arquitetônico e a spec, espere explicitamente a aprovação do usuário.

Somente depois que o usuário disser claramente que aprova o plano você poderá iniciar a implementação.

Se durante a análise você descobrir que alguma proposta deste documento é tecnicamente ruim, incompatível com o projeto ou desnecessária, NÃO a implemente cegamente. Explique o problema no plano e proponha uma alternativa melhor.

======================================================================
1. VISÃO DO PRODUTO
======================================================================

O projeto passa a se chamar:

StreamGrab

A visão é evoluir o projeto de um downloader originalmente focado em HLS/.m3u8 para um aplicativo desktop generalista de download de mídia.

O StreamGrab deve funcionar como uma camada de experiência, gerenciamento e download sobre diferentes tecnologias/fontes.

Objetivo conceitual:

URL
 ↓
Detecção da fonte
 ↓
Análise da mídia
 ↓
Seleção de formato/qualidade
 ↓
Seleção da melhor estratégia de download
 ↓
Download
 ↓
Mux/remux/conversão quando necessário
 ↓
Arquivo final

Fontes/tecnologias atuais e futuras podem incluir:

- HLS (.m3u8)
- MPEG-DASH (.mpd)
- mídia direta
- YouTube
- plataformas suportadas por yt-dlp
- Media Stream/mdstrm quando aplicável
- outras fontes adicionadas futuramente através de providers

O StreamGrab NÃO deve tentar reimplementar centenas de extractors de sites que já são mantidos pelo yt-dlp.

A divisão desejada é:

yt-dlp:
- extração de plataformas/sites
- descoberta de formatos quando apropriado
- compatibilidade com serviços suportados pelo yt-dlp

StreamGrab:
- interface desktop
- experiência do usuário
- análise de mídia
- HLS/DASH
- estratégias de transporte/download
- downloads paralelos
- curl-impersonate quando necessário
- fila
- retomada
- histórico
- progresso
- gerenciamento de arquivos
- FFmpeg/mux
- automação e seleção inteligente de estratégias

======================================================================
2. BRANDING
======================================================================

Auditar todo o repositório procurando referências antigas como:

- hls-m3u8-downloader
- video-downloader
- Video Downloader
- descrições que façam parecer que o programa suporta apenas HLS

Planejar a migração consistente para:

Nome:
StreamGrab

Nome de pacote, caso tecnicamente apropriado:
streamgrab

Descrição sugerida:
Universal video downloader for HLS, DASH, YouTube and supported web platforms.

Tagline sugerida:
Fast, universal video downloader for HLS, DASH, YouTube and the web.

O plano deve identificar alterações necessárias em:

- package.json
- package-lock.json, se aplicável
- Electron
- títulos de janela
- README
- documentação
- exemplos
- caminhos exibidos
- scripts
- metadata de build
- executáveis
- installers
- assets
- nomes internos que realmente precisem ser migrados

Não renomear identificadores internos sem necessidade apenas por branding.

======================================================================
3. ARQUITETURA DE PROVIDERS / ADAPTERS
======================================================================

A arquitetura atual deve ser analisada antes de qualquer mudança.

Queremos evoluir para uma arquitetura extensível baseada em providers/adapters.

Conceito desejado:

URL
 ↓
ProviderRegistry
 ↓
provider.detect(...)
 ↓
provider.inspect(...)
 ↓
provider.getFormats(...)
 ↓
DownloadEngine

Possíveis providers:

providers/
  hls/
  dash/
  youtube/
  direct/
  mdstrm/
  social/

Isso é apenas uma referência conceitual. O agente deve propor a estrutura final depois de analisar o código existente.

Cada provider deve possuir responsabilidades claras.

Avaliar interfaces semelhantes a:

detect(input)
inspect(input, context)
getFormats(media)
prepareDownload(selection, context)

Não force exatamente essas APIs se outra modelagem fizer mais sentido.

O objetivo é permitir adicionar uma nova fonte sem modificar grandes blocos condicionais espalhados pelo sistema.

Criar no plano:

- contrato de Provider
- ProviderRegistry
- prioridades de detecção
- fallback
- tratamento de URLs desconhecidas
- probe por Content-Type quando necessário
- modelo normalizado de MediaInfo
- modelo normalizado de Format/Stream
- tratamento de erros por provider

======================================================================
4. SEPARAÇÃO ENTRE SOURCE, TRANSPORT E MUXER
======================================================================

Uma das principais mudanças arquitetônicas desejadas é separar:

1. O QUE está sendo baixado.
2. COMO os bytes são obtidos.
3. COMO os streams são combinados/processados.

Modelo conceitual:

Source
 ├── HLS
 ├── DASH
 ├── Direct
 └── ExternalProvider

Transport
 ├── HTTP/Fetch
 ├── CurlImpersonate
 ├── ParallelRange
 └── YtDlp, caso faça sentido como transport/runner

Muxer/Processor
 └── FFmpeg

O agente deve analisar se yt-dlp deve ser Provider, Transport, ExternalRunner ou combinação controlada dessas abstrações.

Não criar abstrações artificiais apenas para seguir esta spec.

Queremos baixo acoplamento e responsabilidades claras.

======================================================================
5. DOWNLOAD ENGINE CENTRAL
======================================================================

Planejar um DownloadEngine independente de CLI e Electron.

Ele deve eventualmente ser capaz de receber algo equivalente a:

- source/media
- formato selecionado
- destino
- estratégia
- configurações

E produzir eventos/estado como:

- queued
- analyzing
- preparing
- downloading
- paused
- merging
- converting
- completed
- failed
- cancelled

O engine não deve depender diretamente da interface gráfica.

CLI e Electron devem consumir o mesmo núcleo.

======================================================================
6. EVENTOS E PROGRESSO
======================================================================

Planejar uma API/event bus de progresso consistente.

Exemplos conceituais:

download:start
download:progress
download:speed
download:eta
download:pause
download:resume
download:complete
download:error
download:cancel

O modelo deve suportar:

- bytes baixados
- bytes totais
- porcentagem
- velocidade
- ETA
- etapa atual
- número de chunks
- status do mux
- mensagens relevantes

Evitar acoplar parsing de logs do FFmpeg diretamente à UI.

======================================================================
7. APLICATIVO DESKTOP INSTALÁVEL
======================================================================

O StreamGrab deve evoluir para um aplicativo que um usuário comum consiga instalar.

Planejar distribuição para, idealmente:

Windows:
- StreamGrab-Setup.exe
- versão portable, se fizer sentido

Linux:
- AppImage ou formato apropriado

macOS:
- DMG, se o pipeline e dependências permitirem

Avaliar electron-builder ou alternativa adequada.

O plano deve abordar:

- empacotamento
- FFmpeg
- yt-dlp
- curl-impersonate
- binários por plataforma
- caminhos em desenvolvimento vs produção
- permissões
- assinatura de código como etapa futura
- tamanho do bundle
- atualização das dependências auxiliares
- GitHub Releases

Priorizar Windows inicialmente se multi-plataforma aumentar demais a complexidade.

======================================================================
8. INTERFACE ELECTRON
======================================================================

Planejar uma evolução significativa da interface.

Fluxo principal desejado:

1. Usuário cola uma URL.
2. Clica em Analyze.
3. StreamGrab detecta a fonte.
4. Obtém metadata.
5. Mostra título, duração e informações disponíveis.
6. Lista qualidades/formatos.
7. Usuário seleciona formato e opções.
8. Adiciona à fila ou inicia download.
9. UI mostra progresso.
10. Arquivo concluído pode ser aberto/localizado.

Informações úteis:

- título
- thumbnail quando disponível
- duração
- provider
- protocolo
- resolução
- codec
- container
- bitrate
- tamanho estimado quando possível
- áudio
- legendas quando futuramente suportadas

Não bloquear a UI durante operações demoradas.

======================================================================
9. ANALYZE URL
======================================================================

Criar uma etapa formal de análise antes do download.

Exemplo:

URL
 ↓
Analyze
 ↓
Provider detectado
 ↓
metadata
 ↓
formatos
 ↓
usuário escolhe
 ↓
download

O resultado deve ser normalizado independentemente do provider.

Exemplo conceitual:

MediaInfo {
  title
  duration
  thumbnail
  sourceType
  provider
  formats[]
}

Format {
  id
  resolution
  videoCodec
  audioCodec
  container
  bitrate
  estimatedSize
  hasVideo
  hasAudio
}

A estrutura final deve ser proposta pelo agente.

======================================================================
10. FILA DE DOWNLOADS
======================================================================

Planejar um DownloadQueue.

Cada item deve ter identidade própria e estado.

Estados possíveis:

queued
analyzing
preparing
downloading
paused
merging
completed
failed
cancelled

A fila deve futuramente permitir:

- vários downloads
- limite de downloads simultâneos
- cancelar
- tentar novamente
- pausar quando tecnicamente possível
- retomar
- reordenar futuramente
- remover item
- abrir arquivo
- abrir pasta

Persistência da fila deve ser considerada.

======================================================================
11. DOWNLOAD SOMENTE DE ÁUDIO
======================================================================

Adicionar ao plano suporte para:

- vídeo + áudio
- somente vídeo
- somente áudio

Formatos de áudio possíveis, dependendo da origem e FFmpeg:

- original/best
- M4A
- MP3
- Opus
- FLAC, quando fizer sentido

Evitar conversões desnecessárias.

Diferenciar:

- remux
- copy
- transcode

Mostrar ao usuário quando uma opção exige conversão.

======================================================================
12. PLAYLISTS E DOWNLOAD EM LOTE
======================================================================

Planejar suporte a playlists quando o provider oferecer essa capacidade.

Exemplo:

Playlist detectada
 ↓
lista de itens
 ↓
seleção
 ↓
adicionar selecionados à fila

Funcionalidades:

- selecionar todos
- desmarcar todos
- selecionar itens específicos
- qualidade padrão
- nomeação consistente
- evitar colisões de filenames
- limite de concorrência

Não implementar extractors próprios quando yt-dlp já resolver a fonte.

======================================================================
13. RETOMADA DE DOWNLOADS
======================================================================

Planejar downloads resumíveis.

O comportamento deve depender da estratégia.

Para HTTP Range/chunks, estudar persistência de metadata semelhante a:

DownloadState {
  url
  destination
  totalSize
  validators
  chunks[]
}

Cada chunk pode registrar:

- start
- end
- downloaded
- completed

Considerar:

- ETag
- Last-Modified
- tamanho alterado
- URL expirada
- URLs assinadas
- renovação/reanálise
- arquivo parcial
- atomicidade do state file

Nunca concatenar dados antigos se o recurso remoto mudou.

Para HLS/DASH, analisar uma estratégia apropriada em vez de assumir que resume funciona igual a HTTP Range.

======================================================================
14. SMART TURBO
======================================================================

Evoluir o modo turbo para uma estratégia adaptativa.

Hoje/presentemente pode existir configuração manual de chunks.

Planejar um Smart Turbo que consiga observar:

- suporte a Accept-Ranges
- tamanho do arquivo
- throughput
- throughput por conexão
- latência
- erros
- HTTP 403
- HTTP 429
- HTTP 5xx
- throttling
- estabilidade

E ajustar a concorrência dentro de limites seguros.

Exemplo conceitual:

2 conexões
 ↓
4
 ↓
8
 ↓
12
 ↓
servidor começa a limitar
 ↓
8
 ↓
estabiliza

Não criar comportamento agressivo contra servidores.

Definir limites e backoff.

======================================================================
15. FALLBACK AUTOMÁTICO DE ESTRATÉGIA
======================================================================

Planejar seleção/fallback de estratégia.

Exemplo conceitual:

HTTP normal
 ↓ falha compatível
curl-impersonate
 ↓
download

Ou:

Direct URL
 ↓
Range disponível
 ↓
ParallelRange

Caso contrário:
 ↓
download sequencial

O sistema deve classificar erros para evitar retries inúteis.

Não mascarar erros de autenticação, DRM ou autorização como simples falhas de transporte.

======================================================================
16. CURL-IMPERSONATE
======================================================================

Preservar a capacidade existente quando ela for necessária.

Refatorar conceitualmente para evitar que essa lógica domine o restante do sistema.

Planejar:

CurlImpersonateTransport

ou abstração equivalente.

Tratar:

- headers
- cookies quando fornecidos legitimamente
- referer
- user-agent/perfil
- processos filhos
- cancelamento
- cleanup
- stderr/stdout
- timeouts
- retries
- erros

Não expandir o produto para quebra de DRM ou contorno de controles de acesso.

======================================================================
17. HLS
======================================================================

Fortalecer o módulo HLS.

Planejar testes e suporte robusto para:

- master playlists
- media playlists
- URLs relativas
- variantes
- áudio separado
- EXT-X-MAP
- BYTERANGE
- redirects
- query strings
- headers necessários
- AES-128 quando o usuário tem acesso legítimo e a playlist fornece o fluxo normalmente
- live streams apenas se houver decisão explícita de produto

Detectar DRM/formatos não suportados e retornar erro claro.

======================================================================
18. DASH
======================================================================

Fortalecer o módulo DASH.

Planejar:

- MPD parsing
- representations
- vídeo/áudio separados
- seleção de qualidade
- init segments
- segment templates/timelines
- mux final

Identificar claramente o que já existe e quais lacunas permanecem.

Não implementar suporte para quebra de Widevine/PlayReady.

======================================================================
19. YT-DLP COMO DEPENDÊNCIA ESTRATÉGICA
======================================================================

Não competir com yt-dlp em extractors.

Planejar uma integração robusta.

Responsabilidades possíveis:

- detectar URLs suportadas
- obter metadata
- listar formatos
- playlists
- resolver URLs
- executar downloads em situações em que seja melhor deixar o próprio yt-dlp fazê-los

Avaliar como manter yt-dlp atualizado.

Tratar erros de versão incompatível e mudanças externas.

A UI não deve depender do formato cru do JSON do yt-dlp; normalize os dados no core.

======================================================================
20. FFMPEG
======================================================================

Centralizar interação com FFmpeg.

Planejar um FFmpegService/Muxer/MediaProcessor.

Responsabilidades:

- detectar binário
- executar processos
- remux
- mux áudio + vídeo
- conversão de áudio
- progresso
- cancelamento
- erros
- cleanup

Evitar duplicação de comandos FFmpeg em providers diferentes.

Sempre preferir stream copy quando possível para evitar perda de qualidade e processamento desnecessário.

======================================================================
21. HISTÓRICO
======================================================================

Planejar histórico local de downloads.

Possíveis campos:

- título
- URL original
- provider
- formato
- destino
- data
- status
- tamanho
- duração do download

A UI pode permitir:

- abrir arquivo
- abrir pasta
- baixar novamente
- copiar URL
- remover do histórico
- limpar histórico

Definir política de privacidade: histórico local e controlável pelo usuário.

======================================================================
22. CONFIGURAÇÕES
======================================================================

Planejar uma área Settings.

Possíveis opções:

- pasta padrão
- downloads simultâneos
- Smart Turbo
- limite máximo de conexões
- qualidade padrão
- comportamento de áudio
- formato preferido
- notificações
- tema
- auto-update
- comportamento ao concluir
- retenção de histórico

Não expor configurações técnicas demais ao usuário comum sem necessidade.

======================================================================
23. NOMES DE ARQUIVO
======================================================================

Criar política centralizada de filenames.

Tratar:

- caracteres inválidos no Windows
- Unicode
- nomes reservados
- comprimento
- colisões
- duplicatas
- playlists
- extensão correta

Exemplo:

Video.mp4
Video (1).mp4
Video (2).mp4

Nunca permitir path traversal vindo de metadata externa.

======================================================================
24. SEGURANÇA DO ELECTRON
======================================================================

Auditar Electron.

Verificar:

- contextIsolation
- nodeIntegration
- sandbox quando aplicável
- preload
- IPC
- validação de mensagens
- shell.openExternal
- execução de processos
- argumentos de FFmpeg/yt-dlp/curl
- command injection
- path traversal
- URLs não confiáveis
- CSP

Renderer não deve receber acesso irrestrito ao Node.

Nunca montar comandos como strings de shell com entrada do usuário se argumentos estruturados puderem ser usados.

======================================================================
25. CANCELAMENTO E CLEANUP
======================================================================

Padronizar cancelamento.

Quando o usuário cancelar:

- interromper processos filhos
- cancelar requests
- interromper chunks
- fechar streams
- limpar temporários quando apropriado
- preservar state quando resume estiver habilitado

Evitar processos órfãos.

======================================================================
26. ERROS
======================================================================

Criar taxonomia de erros.

Exemplos:

UnsupportedSourceError
NetworkError
AuthenticationError
ForbiddenError
RateLimitError
ExpiredUrlError
MediaNotFoundError
FFmpegError
YtDlpError
DiskSpaceError
PermissionError
UnsupportedDrmError
CancelledError

A UI deve mostrar mensagens amigáveis e permitir detalhes técnicos separadamente.

======================================================================
27. LOGGING
======================================================================

Planejar logging estruturado.

Níveis:

debug
info
warn
error

Logs devem ajudar diagnóstico sem registrar desnecessariamente:

- cookies
- tokens
- authorization headers
- URLs assinadas completas quando contiverem segredos

Adicionar sanitização/redaction.

Possibilitar exportar log de diagnóstico futuramente.

======================================================================
28. TESTES
======================================================================

Reorganizar testes conceitualmente para algo semelhante a:

tests/
  unit/
  integration/
  e2e/
  fixtures/

Cobrir especialmente:

Unit:
- URL detection
- provider selection
- playlist parsing
- DASH parsing
- filename sanitation
- format normalization
- error classification
- chunk planning
- resume state

Integration:
- FFmpeg
- yt-dlp
- HLS local fixture
- DASH local fixture
- range server local
- fallback de transport

E2E:
- fluxos estáveis e controláveis

Evitar testes dependentes exclusivamente de sites externos que podem mudar.

Criar fixtures e servidores HTTP locais de teste quando possível.

======================================================================
29. REGRESSION TESTS
======================================================================

Antes de grandes refactors, criar characterization/regression tests para comportamentos atuais importantes.

O agente deve identificar quais fluxos atuais precisam ser congelados por testes ANTES da migração arquitetônica.

Objetivo:

refatorar sem quebrar funcionalidades existentes.

======================================================================
30. CI COM GITHUB ACTIONS
======================================================================

Planejar CI.

Em Pull Requests:

- install
- lint
- unit tests
- integration tests possíveis
- build/check Electron

Avaliar matriz de Node suportada.

Em tags/releases:

- build
- empacotamento
- checksums
- artifacts
- GitHub Release

Não publicar automaticamente sem definir segurança e estratégia de release.

======================================================================
31. LINT, FORMAT E QUALIDADE
======================================================================

Avaliar adoção de:

- ESLint
- Prettier ou alternativa
- regras para imports
- análise estática
- TypeScript futuramente

Não migrar para TypeScript automaticamente.

O plano deve avaliar custo/benefício.

Se TypeScript fizer sentido, propor uma migração incremental separada.

======================================================================
32. GITHUB RELEASES E VERSIONAMENTO
======================================================================

Adotar Semantic Versioning.

Avaliar se o projeto realmente deve permanecer em 1.0.0 ou voltar a uma série pré-1.0 enquanto APIs/arquitetura mudam.

Exemplo:

0.1.x — base
0.2.x — desktop
0.3.x — queue/analyze
0.4.x — resume/playlists
1.0.0 — versão considerada estável

Planejar:

- CHANGELOG
- tags
- release notes
- assets
- checksums

======================================================================
33. AUTO-UPDATE
======================================================================

Depois de releases confiáveis, planejar auto-update do aplicativo.

Não implementar antes de definir:

- origem dos updates
- assinatura
- rollback
- canais stable/beta, se necessários
- comportamento offline

======================================================================
34. DOCUMENTAÇÃO
======================================================================

Reescrever README futuramente para apresentar o StreamGrab como produto.

Estrutura sugerida:

# StreamGrab

Descrição curta

Screenshot/GIF

Features

Supported Sources

Installation

Usage

CLI

Architecture

Development

Building

Testing

Troubleshooting

Security / DRM limitations

Contributing

License

Roadmap

Não prometer suporte universal absoluto.

Se disser quantidade de sites suportados, basear a afirmação no mecanismo real e evitar número hardcoded que fique desatualizado.

======================================================================
35. CONTRIBUTING
======================================================================

Planejar:

CONTRIBUTING.md

Explicar:

- setup
- arquitetura
- criação de provider
- testes
- estilo
- Pull Requests

A arquitetura de providers deve tornar contribuições externas simples.

======================================================================
36. ROADMAP PÚBLICO
======================================================================

Criar um roadmap claro, por exemplo:

FASE A — Fundação
- branding
- testes de regressão
- arquitetura
- DownloadEngine
- providers
- transports
- FFmpeg central

FASE B — Produto Desktop
- Analyze URL
- nova UI
- fila
- progresso
- installer
- releases

FASE C — Download Management
- resume
- histórico
- settings
- áudio
- playlists

FASE D — Performance
- Smart Turbo
- fallback automático
- tuning

FASE E — Maturidade
- CI completo
- auto-update
- multi-plataforma
- documentação
- segurança
- observabilidade

O agente deve melhorar essa divisão com base no código real.

======================================================================
37. ESPAÇO EM DISCO
======================================================================

Adicionar ao plano validação de espaço disponível antes de downloads grandes quando o tamanho for conhecido/estimável.

Considerar espaço temporário adicional quando áudio e vídeo forem baixados separadamente antes do mux.

======================================================================
38. DOWNLOAD ATÔMICO
======================================================================

Planejar uso de arquivos temporários/partiais.

Exemplo:

video.mp4.part

Somente depois de concluir e validar:

video.mp4

Evitar deixar arquivos finais aparentemente válidos mas incompletos.

======================================================================
39. INTEGRIDADE
======================================================================

Quando possível:

- validar Content-Length
- validar chunks
- detectar respostas Range incorretas
- detectar HTML/JSON de erro retornado no lugar de mídia
- verificar resultado do FFmpeg
- não marcar como completed antes do pipeline terminar

======================================================================
40. RETRIES E BACKOFF
======================================================================

Centralizar políticas de retry.

Não repetir cegamente qualquer erro.

Considerar:

- timeout
- connection reset
- 429
- 5xx
- Retry-After

Usar exponential backoff + jitter quando apropriado.

Não retry automático de erros permanentes.

======================================================================
41. LIMITES DE RECURSOS
======================================================================

Planejar limites para:

- downloads simultâneos
- conexões por download
- processos FFmpeg
- memória
- arquivos temporários

Evitar que várias tarefas pesadas tornem o computador inutilizável.

======================================================================
42. UX DE FALHAS
======================================================================

Em vez de apenas:

Download failed

Mostrar algo como:

Falha no download

Motivo:
A URL expirou.

Ação sugerida:
Analise novamente a URL para obter um novo endereço.

[Analisar novamente] [Detalhes]

Separar mensagem amigável de stack trace/log técnico.

======================================================================
43. DETECÇÃO DE DRM / LIMITAÇÕES
======================================================================

O StreamGrab não deve se posicionar como ferramenta de quebra de DRM.

Planejar detecção clara quando possível para:

- Widevine
- PlayReady
- FairPlay
- outros esquemas não suportados

Retornar erro explícito e seguro.

Não tentar contornar DRM.

======================================================================
44. CLI
======================================================================

Não abandonar a CLI.

CLI e Electron devem compartilhar o core.

Planejar comandos futuramente semelhantes a:

streamgrab <url>
streamgrab analyze <url>
streamgrab download <url>
streamgrab --audio-only <url>

A sintaxe final deve respeitar compatibilidade e ser definida no plano.

======================================================================
45. API INTERNA ESTÁVEL
======================================================================

Definir limites entre módulos.

A UI não deve importar internals aleatórios.

Preferir uma fachada semelhante a:

StreamGrabCore

analyze(...)
enqueue(...)
download(...)
pause(...)
resume(...)
cancel(...)
getQueue(...)
getHistory(...)

Não necessariamente usar exatamente esses nomes.

======================================================================
46. PERSISTÊNCIA
======================================================================

Avaliar armazenamento local apropriado para:

- settings
- queue
- history
- resume metadata

Opções podem incluir:

- JSON com escrita atômica
- SQLite
- outra solução simples

O agente deve justificar a escolha.

Não adicionar banco de dados complexo sem necessidade.

======================================================================
47. MIGRAÇÃO INCREMENTAL
======================================================================

REGRA CRÍTICA:

Não reescrever tudo de uma vez.

O plano deve permitir algo como:

arquitetura antiga
 ↓
criação de interfaces novas
 ↓
adaptar módulo existente
 ↓
testar
 ↓
migrar próximo módulo
 ↓
testar
 ↓
remover legado somente quando seguro

Priorizar strangler pattern/adapters sobre big-bang rewrite.

======================================================================
48. COMPATIBILIDADE
======================================================================

Antes de remover qualquer comportamento existente:

- identificar quem usa
- criar teste
- criar substituto
- migrar
- validar
- somente então remover

Preservar CLI atual sempre que razoável durante a migração.

======================================================================
49. PERFORMANCE
======================================================================

Criar baseline antes de otimizações.

Medir:

- tempo de análise
- velocidade de download
- CPU
- memória
- tempo de mux
- overhead do Electron
- comportamento com arquivos grandes

Smart Turbo deve ser orientado por métricas, não suposição.

======================================================================
50. CRITÉRIOS DE SUCESSO DO PRODUTO
======================================================================

Ao final da evolução, o StreamGrab deve idealmente:

- instalar facilmente
- aceitar uma URL
- detectar a fonte
- analisar mídia
- listar formatos
- baixar com estratégia apropriada
- mostrar progresso confiável
- permitir fila
- lidar bem com erros
- retomar downloads quando suportado
- gerar arquivo final corretamente
- usar yt-dlp sem acoplar a UI ao seu formato interno
- suportar HLS/DASH de forma robusta
- compartilhar core entre CLI e Electron
- ser extensível por providers
- possuir testes
- possuir CI
- possuir releases
- possuir documentação clara
- não tentar quebrar DRM

======================================================================
51. ENTREGÁVEIS DA PRIMEIRA FASE — SOMENTE PLANEJAMENTO
======================================================================

ANTES DE ESCREVER CÓDIGO, entregue:

A. AUDITORIA DO ESTADO ATUAL

Descrever:

- arquitetura atual
- entrypoints
- módulos
- fluxo CLI
- fluxo Electron
- fluxo HLS
- fluxo DASH
- fluxo yt-dlp
- fluxo curl-impersonate
- fluxo turbo/range
- FFmpeg
- dependências
- testes
- packaging
- principais acoplamentos
- dívida técnica
- riscos

B. MAPA DE DEPENDÊNCIAS

Mostrar quais módulos dependem de quais.

Identificar ciclos e acoplamentos problemáticos.

C. ARQUITETURA PROPOSTA

Fornecer diagrama textual.

Exemplo:

Electron ─┐
          ├─> Application/Core
CLI ──────┘
               │
        ProviderRegistry
               │
      ┌────────┼────────┐
     HLS      DASH     YtDlp
               │
        DownloadEngine
               │
      Transport Strategy
               │
           FFmpeg
               │
            Output

Melhorar esse desenho conforme necessário.

D. ESTRUTURA DE DIRETÓRIOS PROPOSTA

Mostrar árvore completa relevante.

E. CONTRATOS

Definir interfaces/objetos principais:

- Provider
- MediaInfo
- Format
- DownloadJob
- DownloadEngine
- Transport
- Processor/Muxer
- Queue
- persistence
- errors
- events

F. DATA FLOW

Explicar passo a passo:

1. Analyze
2. Download
3. Progress
4. Cancel
5. Resume
6. Completion
7. Failure

G. PLANO DE MIGRAÇÃO

Dividir em fases.

Cada fase deve conter:

- objetivo
- arquivos afetados
- arquivos novos
- dependências
- riscos
- testes
- critérios de aceitação
- rollback

H. PLANO DE TESTES

Definir testes necessários antes, durante e depois.

I. PLANO DE RELEASE

Explicar como sair do estado atual para builds instaláveis e releases.

J. RISCOS

Listar riscos técnicos e de produto.

Classificar:

- crítico
- alto
- médio
- baixo

K. DECISÕES QUE PRECISAM DE APROVAÇÃO

Listar decisões arquitetônicas importantes para o usuário escolher.

L. ESTIMATIVA DE COMPLEXIDADE

Para cada fase:

- baixa
- média
- alta
- muito alta

Não inventar estimativas de tempo exatas sem dados suficientes.

======================================================================
52. FORMATO DA RESPOSTA DO AGENTE
======================================================================

O agente deve produzir um documento chamado conceitualmente:

STREAMGRAB_ARCHITECTURE_PLAN.md

Estrutura:

# StreamGrab Architecture Plan

## 1. Executive Summary
## 2. Current Architecture Audit
## 3. Current Data Flows
## 4. Problems and Technical Debt
## 5. Target Architecture
## 6. Architecture Diagram
## 7. Proposed Directory Structure
## 8. Core Domain Models
## 9. Provider Architecture
## 10. Transport Architecture
## 11. Download Engine
## 12. Queue and Persistence
## 13. Electron Architecture
## 14. CLI Architecture
## 15. Security
## 16. Error Model
## 17. Logging
## 18. Testing Strategy
## 19. CI/CD and Releases
## 20. Migration Strategy
## 21. Implementation Phases
## 22. Risks
## 23. Alternatives Considered
## 24. Decisions Requiring Approval
## 25. Acceptance Criteria
## 26. Recommended Execution Order

Depois do documento:

STOP.

Mostrar claramente:

"PLANO CONCLUÍDO — AGUARDANDO APROVAÇÃO PARA IMPLEMENTAÇÃO."

Não executar nenhuma alteração até receber aprovação explícita.

======================================================================
53. REGRAS PARA A IMPLEMENTAÇÃO POSTERIOR
======================================================================

Estas regras só passam a valer DEPOIS da aprovação do plano.

Quando autorizado:

1. Implementar uma fase por vez.
2. Antes de cada fase, verificar os testes existentes.
3. Criar/ajustar testes primeiro quando necessário.
4. Fazer mudanças pequenas.
5. Rodar testes após cada etapa.
6. Não remover código antigo antes do substituto estar validado.
7. Não misturar refactor gigante com feature gigante.
8. Manter commits logicamente separáveis, caso esteja autorizado a criar commits.
9. Registrar decisões arquitetônicas relevantes.
10. Atualizar documentação conforme o comportamento mudar.
11. Reportar regressões imediatamente.
12. Não esconder testes quebrados.
13. Não alterar escopo silenciosamente.
14. Não adicionar dependências sem justificar.
15. Preservar segurança na execução de processos externos.
16. Nunca implementar bypass de DRM.

======================================================================
54. PRINCÍPIO FINAL
======================================================================

Não queremos simplesmente "adicionar features".

Queremos transformar o StreamGrab em um projeto sustentável.

Prioridades:

1. Correção
2. Segurança
3. Arquitetura
4. Confiabilidade
5. UX
6. Testabilidade
7. Performance
8. Extensibilidade
9. Distribuição
10. Novas features

Evite overengineering.

Se uma abstração não resolver um problema real do StreamGrab, não a crie.

Se uma mudança puder ser feita incrementalmente, prefira isso a uma reescrita.

A meta é que o StreamGrab evolua de:

"um downloader que acumulou vários modos de download"

para:

"uma plataforma desktop modular de download de mídia, com um core independente, providers extensíveis, estratégias de transporte, gerenciamento de downloads e uma experiência consistente."

======================================================================
AÇÃO AGORA
======================================================================

Analise o repositório completo.

NÃO MODIFIQUE NADA.

Produza primeiro o plano arquitetônico e a spec descritos acima.

Ao terminar, pare e aguarde minha aprovação explícita.

Somente depois da minha aprovação você poderá executar a migração.
