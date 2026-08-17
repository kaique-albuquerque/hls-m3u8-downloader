#!/usr/bin/env node
/**
 * Downloader interativo do Mercado Play (DRM Widevine)
 *
 * Uso:
 *   node tools/drm-mercado-play.mjs
 *   npm run drm:mp
 *
 * Guia o usuário passo a passo:
 *   1. Pede o link do MPD (Manifest DASH)
 *   2. Pede as chaves KID:KEY uma por uma (Enter vazio para terminar)
 *   3. Pede o idioma do áudio (opcional)
 *   4. Baixa, descriptografa e muxa automaticamente
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOWNLOADS = path.join(os.homedir(), 'Downloads');

const NMDL = path.join(ROOT, 'vendor', 'n_m3u8dl-re', 'N_m3u8DL-RE.exe');
const FFMPEG = path.join(ROOT, 'vendor', 'ffmpeg', 'ffmpeg.exe');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function pergunta(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function log(step, msg) {
  console.log(`\n[${step}] ${msg}`);
}

// Cores simples para terminal (desativadas se não for TTY)
const cor = (txt, code) => (process.stdout.isTTY ? `\x1b[${code}m${txt}\x1b[0m` : txt);
const verde = (t) => cor(t, '32');
const amarelo = (t) => cor(t, '33');
const vermelho = (t) => cor(t, '31');
const ciano = (t) => cor(t, '36');
const negrito = (t) => cor(t, '1');

function run(cmd, argsList, opts = {}) {
  return spawnSync(cmd, argsList, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50, ...opts });
}

/**
 * Tenta encontrar as chaves do vídeo no arquivo widevineproxy2-keys.json
 * (exportado da extensão WidevineProxy2). Compara o URL do manifest com o
 * URL do MPD informado (por hash/exp/session comuns) e, se achar, devolve
 * os pares KID:KEY daquela entrada.
 *
 * @param {string} url - URL do MPD colada pelo usuário.
 * @returns {Array<string>} pares "KID:KEY" ou [].
 */
function chavesDoJsonExportado(url) {
  const caminho = path.join(ROOT, 'widevineproxy2-keys.json');
  if (!fs.existsSync(caminho)) return [];

  // Normaliza para comparação: remove a parte exp=...~id=...~hmac=... (que muda)
  // e mantém o restante do path (estável entre refreshes do MPD).
  const norm = (u) => String(u || '').replace(/\/out\/v1\/exp=[^/]+/i, '/out/v1/').replace(/[?#].*$/, '');

  try {
    const data = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    const alvo = norm(url);
    const achados = [];

    for (const [pssh, entry] of Object.entries(data)) {
      const manifestUrl = entry.manifests?.[0]?.url || '';
      if (!manifestUrl) continue;
      if (norm(manifestUrl) !== alvo) continue;

      for (const k of entry.keys || []) {
        if (k.kid && k.k) {
          const par = `${k.kid.replace(/-/g, '').toLowerCase()}:${k.k}`;
          if (!achados.includes(par)) achados.push(par);
        }
      }
      if (achados.length) break;
    }
    return achados;
  } catch {
    return [];
  }
}

async function main() {
  console.log('');
  console.log(negrito(ciano('============================================')));
  console.log(negrito(ciano('   Mercado Play Downloader (DRM Widevine)')));
  console.log(negrito(ciano('============================================')));
  console.log('');
  console.log(amarelo('Você vai precisar de 2 coisas do navegador:'));
  console.log(amarelo('  1. O link do MPD  → extensão WidevineProxy2 → botão "Manifest DASH → copy"'));
  console.log(amarelo('  2. As chaves KID:KEY → extensão WidevineProxy2 → botão "Keys → copy"'));
  console.log('');

  // ------------------------------------------------------------------
  // 1. Link do MPD
  // ------------------------------------------------------------------
  const url = (await pergunta(negrito('📎 Cole o link do MPD (Manifest DASH):\n> '))).trim();
  if (!url.startsWith('http')) {
    console.log(vermelho('\n❌ Link inválido. Cole a URL completa começando com https://'));
    rl.close();
    process.exit(1);
  }
  console.log(verde('  ✓ Link recebido!'));

  // ------------------------------------------------------------------
  // 2. Chaves — tenta achar no JSON exportado da extensão
  // ------------------------------------------------------------------
  const chavesJson = chavesDoJsonExportado(url);
  if (chavesJson.length) {
    console.log('');
    console.log(verde('  🎯 Encontrei as chaves deste vídeo no arquivo widevineproxy2-keys.json!'));
    console.log(verde(`  🔑 ${chavesJson.length} chave(s) identificada(s) automaticamente.`));
    const usarAuto = (await pergunta(negrito('Usar essas chaves automaticamente? (S/n):\n> '))).trim().toLowerCase();
    if (usarAuto !== 'n' && usarAuto !== 'nao' && usarAuto !== 'não') {
      const keys = chavesJson;
      console.log(verde(`  ✓ ${keys.length} chave(s) carregada(s) do JSON!`));
      await continuarFluxo({ url, keys, rl });
      return;
    }
    console.log(amarelo('  OK, você vai colar manualmente...'));
  }

  /** Normaliza e valida um par KID:KEY (32 hex cada). Retorna null se inválido. */
  function normalizaChave(raw) {
    const s = String(raw || '').trim().replace(/\r/g, '');
    if (!s) return null;
    const idx = s.indexOf(':');
    if (idx < 0) return null;
    const kid = s.slice(0, idx).replace(/-/g, '').toLowerCase();
    const key = s.slice(idx + 1).replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(kid) || !/^[0-9a-f]{32}$/.test(key)) return null;
    return `${kid}:${key}`;
  }

  // Coleta manual (loop interativo)
  console.log(amarelo('\nAgora cole as chaves UMA POR VEZ no formato:'));
  console.log(amarelo('  KID:KEY'));
  console.log(amarelo('  Você também pode colar VÁRIAS de uma vez (uma por linha).'));
  console.log(amarelo('  Aperte Enter com o campo VAZIO quando terminar.\n'));

  const keys = [];
  while (true) {
    const entrada = (await pergunta(`🔑 Chave ${keys.length + 1} (Enter vazio = terminar):\n> `)).trim();
    if (!entrada) {
      if (keys.length === 0) {
        console.log(vermelho('\n⚠️  Nenhuma chave informada. Não dá para continuar.'));
        rl.close();
        process.exit(1);
      }
      break;
    }

    // Divide por linhas — aceita colar várias chaves de uma vez
    const linhas = entrada.split(/\r?\n/).filter(Boolean);
    let aceitas = 0;
    for (const linha of linhas) {
      const par = normalizaChave(linha);
      if (!par) {
        console.log(amarelo(`  ⚠️  Ignorado (KID ou KEY não é hex de 32): "${linha.slice(0, 60)}..."`));
        continue;
      }
      if (!keys.includes(par)) {
        keys.push(par);
        aceitas++;
        console.log(verde(`  ✓ Chave adicionada (KID ${par.slice(0, 8)}...)`));
      }
    }
    if (aceitas === 0 && linhas.length === 1) {
      console.log(amarelo('  ⚠️  Formato inválido. Use KID:KEY — ex: 5dc26456869637ca80bd0da7997b18c5:de600a57dde164ccf1e6d43bb55632d8'));
    }
  }

  console.log(verde(`\n  ✓ ${keys.length} chave(s) coletada(s)!`));

  // ------------------------------------------------------------------
  // 3. Idioma do áudio (opcional)
  // ------------------------------------------------------------------
  const audioRaw = (await pergunta(`\n🎧 Idioma do áudio? (pt, en, es) [padrão: pt]:\n> `)).trim();
  const audioLang = audioRaw || 'pt';
  console.log(verde(`  ✓ Áudio: ${audioLang}`));

  // ------------------------------------------------------------------
  // 3b. Legendas (opcional)
  // ------------------------------------------------------------------
  const subsRaw = (await pergunta(`\n💬 Baixar legendas também? (s/N):\n> `)).trim().toLowerCase();
  let subLang = '';
  if (subsRaw === 's' || subsRaw === 'sim') {
    const subRaw2 = (await pergunta(`🌐 Idioma da legenda? (pt, en, es) [padrão: pt]:\n> `)).trim();
    subLang = subRaw2 || 'pt';
    console.log(verde(`  ✓ Legendas: ${subLang}`));
  }

  // ------------------------------------------------------------------
  // 4. Nome do arquivo (opcional)
  // ------------------------------------------------------------------
  const nomeRaw = (await pergunta(`\n📝 Nome do arquivo final? (sem extensão) [padrão: mercadoplay]:\n> `)).trim();
  const nome = nomeRaw || 'mercadoplay';

  // ------------------------------------------------------------------
  // Resumo e confirmação
  // ------------------------------------------------------------------
  console.log(negrito(ciano('\n══════════ RESUMO ══════════')));
  console.log(`  📎 MPD:    ${url.slice(0, 60)}...`);
  console.log(`  🔑 Chaves: ${keys.length}`);
  keys.forEach((k) => console.log(`      ${k.slice(0, 8)}...:${k.slice(-8)}`));
  console.log(`  🎧 Áudio:  ${audioLang}`);
  console.log(`  � Legenda: ${subLang ? subLang : 'não'}`);
  console.log(`  �📝 Nome:   ${nome}`);
  console.log(ciano('═══════════════════════════\n'));

  const conf = (await pergunta(negrito('Começar o download? (s/N): '))).trim().toLowerCase();
  if (conf !== 's' && conf !== 'sim') {
    console.log(amarelo('\nCancelado. Nada foi baixado.'));
    rl.close();
    process.exit(0);
  }

  rl.close();

  // ------------------------------------------------------------------
  // 5. Baixa e filtra o MPD
  // ------------------------------------------------------------------
  log('1/4', 'Baixando e filtrando o MPD (removendo anúncios e trilhas sem chave)...');
  let mpdText;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mpdText = await res.text();
  } catch (e) {
    console.log(vermelho(`\n❌ Falha ao baixar o MPD: ${e.message}`));
    console.log(amarelo('   O link pode ter EXPIRADO (duram poucos minutos).'));
    console.log(amarelo('   Abra o vídeo de novo no navegador e pegue um link novo.'));
    process.exit(1);
  }

  const keyMap = {};
  for (const k of keys) {
    const [kid, key] = k.split(':');
    keyMap[kid] = key;
  }

  // ── Diagnóstico: KIDs do MPD vs chaves fornecidas ──
  const allKids = [...new Set([...mpdText.matchAll(/default_KID="([^"]+)"/gi)].map((m) => m[1].replace(/-/g, '').toLowerCase()))];
  const missingKids = allKids.filter((k) => k && !keyMap[k]);
  if (missingKids.length) {
    console.log(amarelo(`\n⚠️  KIDs do MPD sem chave: ${missingKids.join(', ')}`));
  }

  const filtered = mpdText.replace(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi, (block, attrs, inner) => {
    const blockKids = [...new Set([...block.matchAll(/default_KID="([^"]+)"/gi)].map((m) => m[1].replace(/-/g, '').toLowerCase()))];
    const hasCP = /<ContentProtection/i.test(block);
    const mime = /mimeType="([^"]+)"/i.exec(attrs)?.[1] || '';
    const isSub = mime.startsWith('application/') || /contentType="(text|subtitle)"/i.test(attrs);

    if (isSub) return block; // legenda: mantém (não é criptografada)
    if (!hasCP && blockKids.length === 0) return ''; // anúncio (vídeo/áudio sem proteção)
    if (blockKids.some((k) => k && !keyMap[k])) return ''; // sem chave
    return block;
  });

  const remainingKids = [...new Set([...filtered.matchAll(/default_KID="([^"]+)"/gi)].map((m) => m[1].replace(/-/g, '').toLowerCase()))];
  if (!remainingKids.length) {
    console.log(vermelho('\n❌ Nenhuma trilha com chave encontrada.'));
    console.log(amarelo('   Verifique se as chaves estão corretas e correspondem a este vídeo.'));
    process.exit(1);
  }
  console.log(verde(`  ✓ MPD filtrado: ${remainingKids.length} trilha(s) com chave`));

  // ── Detecta se sobrou alguma trilha de VÍDEO ──
  const videoKid = [...filtered.matchAll(/<AdaptationSet\b([^>]*)>[\s\S]*?<\/AdaptationSet>/gi)]
    .filter((m) => /mimeType="video\//i.test(m[1]))
    .map((m) => [...m[0].matchAll(/default_KID="([^"]+)"/gi)].map((k) => k[1].replace(/-/g, '').toLowerCase())[0])
    .find(Boolean);

  if (!videoKid) {
    console.log('');
    console.log(vermelho('⚠️  PROBLEMA: nenhuma trilha de VÍDEO sobrou no filtro!'));
    console.log('');
    console.log(amarelo('   O vídeo deste MPD usa uma chave que VOCÊ NÃO COLOU.'));
    console.log(amarelo('   As chaves que você tem são só de ÁUDIO/legendas.'));
    console.log('');
    console.log(amarelo('   Como resolver:'));
    console.log(amarelo('   1. No WidevineProxy2, veja TODAS as chaves do History'));
    console.log(amarelo('   2. Identifique a chave do VÍDEO (KID pode ser diferente do áudio)'));
    console.log(amarelo('   3. Rode o comando de novo e cole TODAS as chaves (vídeo + áudio)'));
    console.log('');
    console.log(amarelo(`   KIDs do MPD: ${allKids.join(', ')}`));
    console.log(amarelo(`   KIDs que você tem: ${Object.keys(keyMap).join(', ') || '(nenhum)'}`));
    console.log(amarelo(`   KIDs SEM chave: ${missingKids.join(', ') || '(nenhum)'}`));
    console.log('');
    process.exit(1);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpdl-'));
  const filteredMpd = path.join(workDir, 'filtered.mpd');
  fs.writeFileSync(filteredMpd, filtered);

  // ------------------------------------------------------------------
  // 6. Download com N_m3u8DL-RE
  // ------------------------------------------------------------------
  log('2/4', `Baixando e descriptografando (vídeo + áudio ${audioLang})...`);
  if (!fs.existsSync(NMDL)) {
    console.log(vermelho('\n❌ N_m3u8DL-RE não encontrado.'));
    console.log(amarelo('   Rode: npm run drm:setup'));
    process.exit(1);
  }
  const dlDir = path.join(workDir, 'dl');
  fs.mkdirSync(dlDir, { recursive: true });

  const keyArgs = keys.flatMap((k) => ['--key', k]);
  const subArgs = subLang ? ['-ss', `lang=${subLang}`] : [];
  const dl = run(NMDL, [
    filteredMpd,
    ...keyArgs,
    '-sv', 'best',
    '-sa', `lang=${audioLang}`,
    ...subArgs,
    '-M', 'format=mp4',
    '--save-dir', dlDir,
  ], { allowFail: true });

  if (dl.status !== 0) {
    console.log(vermelho('\n❌ Download falhou:'));
    console.log((dl.stdout || '').split('\n').slice(-10).join('\n'));
    console.log((dl.stderr || '').split('\n').slice(-10).join('\n'));
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // 7. Muxa com FFmpeg
  // ------------------------------------------------------------------
  const files = fs.readdirSync(dlDir);
  const videoFile = files.find((f) => f.endsWith('.mp4'));
  const audioFile = files.find((f) => f.endsWith('.m4a'));
  const subFile = files.find((f) => /\.(vtt|srt|ass|ssa|stpp)$/i.test(f) || /\.pt\.|\.en\.|\.es\./i.test(f));
  if (!videoFile) {
    console.log(vermelho('\n❌ Nenhum arquivo de vídeo foi gerado.'));
    console.log(amarelo('   As chaves podem não cobrir o vídeo deste MPD.'));
    console.log(amarelo('   Verifique se copiou as chaves certas do WidevineProxy2 para ESTE vídeo.'));
    process.exit(1);
  }

  const finalFile = path.join(DOWNLOADS, `${nome}.mp4`);
  fs.mkdirSync(path.dirname(finalFile), { recursive: true });
  log('3/4', 'Juntando vídeo + áudio' + (subFile ? ' + legendas' : '') + ' em um único arquivo...');

  const muxArgs = ['-y', '-v', 'error', '-i', path.join(dlDir, videoFile)];
  if (audioFile) muxArgs.push('-i', path.join(dlDir, audioFile));
  if (subFile) muxArgs.push('-i', path.join(dlDir, subFile));
  muxArgs.push('-map', '0:v:0');
  if (audioFile) muxArgs.push('-map', '1:a:0');
  if (subFile) muxArgs.push('-map', '2:s:0', '-c:s', 'mov_text');
  muxArgs.push('-c', 'copy', '-movflags', '+faststart', finalFile);
  const mux = run(FFMPEG, muxArgs, { allowFail: true });
  if (mux.status !== 0) {
    console.log(vermelho('\n❌ Falha ao juntar os arquivos:'));
    console.log((mux.stderr || '').split('\n').slice(-5).join('\n'));
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // 8. Limpa e conclui
  // ------------------------------------------------------------------
  fs.rmSync(workDir, { recursive: true, force: true });

  const sizeMB = (fs.statSync(finalFile).size / 1024 / 1024).toFixed(0);
  console.log('');
  console.log(negrito(verde('══════════════════════════════════════')));
  console.log(negrito(verde('  ✅ DOWNLOAD CONCLUÍDO COM SUCESSO!')));
  console.log(negrito(verde('══════════════════════════════════════')));
  console.log(`  📁 Arquivo: ${finalFile}`);
  console.log(`  💾 Tamanho: ${sizeMB} MB`);
  console.log('');
}

main().catch((e) => {
  console.error(vermelho(`\n❌ Erro inesperado: ${e.message}`));
  process.exit(1);
});
