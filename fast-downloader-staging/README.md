# fast-downloader

CLI para baixar arquivos HTTP/HTTPS com suporte a modo turbo por partes.

## Instalação local

```bash
npm install
```

## Uso

```bash
fast-downloader <url> [opções]
```

Exemplos:

```bash
fast-downloader "https://example.com/file.zip"
fast-downloader "https://example.com/file.iso" --turbo --concurrency 16
fast-downloader "https://example.com/file.tgz" --output "C:\\Downloads" --filename rom.tgz
```

## Opções

- `--output`, `-o`: pasta de saída
- `--filename`: nome final do arquivo
- `--turbo`: ativa download paralelo por partes quando o servidor suporta `Range`
- `--concurrency`, `--chunks`: conexões paralelas do turbo
- `--block-count`: quantidade total de blocos
- `--header "Chave: valor"`: adiciona header HTTP
- `--help`: mostra ajuda

## Comportamento

- Faz probe do arquivo com `HEAD`, `GET Range 0-0` e `GET` simples
- Detecta nome, tamanho, `etag` e `last-modified` quando disponíveis
- Se `--turbo` estiver ligado e o servidor suportar `Range`, baixa em partes e mescla no final
- Se `Range` não for suportado, cai para download sequencial automaticamente
