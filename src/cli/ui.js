import fs from 'node:fs';
import path from 'node:path';
import { ensureMp4, formatKbps, sanitizeFilename } from '../utils.js';

export function printHeader(io) {
  io.log('==============================================');
  io.log('   StreamGrab - HLS / DASH / Midia direta');
  io.log('   via FFmpeg + curl-impersonate (opcional)');
  io.log('==============================================');
}

export function printUsage(io) {
  io.log('');
  io.log('StreamGrab - HLS / DASH / Midia direta via FFmpeg');
  io.log('');
  io.log('Uso:');
  io.log('  npm start');
  io.log('  node src/index.js');
  io.log('  npm run download:curl');
  io.log('  npm run download:youtube');
  io.log('');
  io.log('Opcoes:');
  io.log('  --curl-impersonate   Forca o modo curl-impersonate para HLS');
  io.log('  --youtube            Entra no fluxo do adaptador de YouTube');
  io.log('  --cookie             Define o header Cookie para URLs protegidas');
  io.log('  --cookies <arquivo>  Usa cookies.txt (Netscape) p/ conteudo autenticado (yt-dlp)');
  io.log('  --cookies-from-browser <b>  Extrai cookies do navegador: chrome, edge, firefox...');
  io.log('  --turbo              Download paralelo por partes (mais rapido em URLs diretas)');
  io.log('  --chunks <n>         Numero de conexoes do modo turbo (padrao: 8)');
  io.log('');
}

export function printFfmpegHelp(io) {
  io.log('');
  io.log('Como instalar o FFmpeg no Windows:');
  io.log('  1. Baixe uma build estavel em https://www.gyan.dev/ffmpeg/builds/');
  io.log('  2. Extraia o ZIP em uma pasta, por exemplo C:\\ffmpeg.');
  io.log('  3. Adicione a pasta bin ao PATH.');
  io.log('  4. Abra um novo terminal e teste com: ffmpeg -version');
}

export function print403(io) {
  io.error('\n[ERRO 403] A URL foi recusada pelo servidor.');
  io.error('Ela pode ter expirado ou o servidor pode exigir os mesmos headers HTTP utilizados pelo navegador.');
  io.error('Obtenha uma Request URL nova no DevTools e tente novamente.');
  io.error('Se o servidor exigir headers especificos (Referer, Origin, User-Agent),');
  io.error('configure-os em config.json ou use --referer / --origin / --user-agent.');
  io.error('Obs.: alguns CDNs bloqueiam qualquer cliente que nao seja um navegador real.');
  io.error('Nesse caso, o modo curl-impersonate (--curl-impersonate) pode contornar o bloqueio.');
}

export function printCurlImpHelp(io) {
  io.log('');
  io.log('Como instalar o curl-impersonate no Windows:');
  io.log('  1. Acesse https://github.com/lexiforest/curl-impersonate/releases');
  io.log('  2. Extraia o ZIP em qualquer pasta.');
  io.log('  3. Coloque o binario em tools/ ou no PATH.');
  io.log('  4. Rode novamente com: npm run download:curl');
}

export function describeSourceType(sourceType) {
  if (sourceType === 'hls') return 'HLS (.m3u8)';
  if (sourceType === 'dash') return 'DASH (.mpd)';
  if (sourceType === 'direct') return 'midia direta';
  if (sourceType === 'youtube') return 'YouTube';
  if (sourceType === 'social') return 'rede social';
  return 'desconhecido';
}

export async function chooseVariant(ask, io, variants, masterUrl = '') {
  io.log('\nQualidades encontradas:');
  variants.forEach((v, i) => {
    const suffix = v.height && !String(v.resolution || '').includes(`${v.height}p`) ? ` (${v.height}p)` : '';
    const label = v.resolution
      ? `${v.resolution}${suffix}${v.bandwidth ? `  ~${formatKbps(v.bandwidth)}` : ''}`
      : `BANDWIDTH ${v.bandwidth}`;
    io.log(`  ${i + 1}. ${label}`);
  });
  io.log('  0. Cancelar');

  const raw = (await ask('\nEscolha (Enter = melhor disponivel): ')).trim();
  if (raw === '0') return null;

  let index = 1;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= variants.length) {
      index = parsed;
    } else {
      io.log(`[AVISO] Opcao invalida. Usando a melhor disponivel (${variants[0].resolution || 'variante 1'}).`);
    }
  }
  return masterUrl ? new URL(variants[index - 1].uri, masterUrl).toString() : variants[index - 1].uri;
}

export async function resolveExistingFile(ask, io, output) {
  while (fs.existsSync(output)) {
    io.log(`\n[AVISO] O arquivo ja existe: ${output}`);
    const choice = (await ask('(S)obrescrever, (N)ovo nome, (C)ancelar? ')).trim().toUpperCase();
    if (choice.startsWith('S')) return { action: 'overwrite', output };
    if (choice.startsWith('N')) {
      const newName = await ask('Novo nome do arquivo: ');
      output = path.join(path.dirname(output), ensureMp4(sanitizeFilename(newName)));
      continue;
    }
    return { action: 'cancel', output };
  }
  return { action: 'ok', output };
}
