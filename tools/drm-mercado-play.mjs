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
const CURL = path.join(ROOT, 'tools', 'curl-impersonate.exe');

const REMOTE_HOST = 'https://getwvkeys.cc/api/remotecdm/widevine';
const REMOTE_DEVICE = 'getwvkeys';
const REMOTE_SECRET = 'getwvkeys';
const LICENSE_URL = 'https://lic.drmtoday.com/license-proxy-widevine/cenc/?specConform=true';

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

// ---------------------------------------------------------------------------
// curl-impersonate helper
// ---------------------------------------------------------------------------
function curlImp(args, { raw = false } = {}) {
  const r = spawnSync(CURL, ['--impersonate', 'firefox147', '-s', '--compressed', '-m', '60', ...args], {
    encoding: raw ? null : 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  return r;
}

function remoteGet(pathName) {
  const r = curlImp([
    `${REMOTE_HOST}/${REMOTE_DEVICE}/${pathName}`,
    '-H', `X-Secret-Key: ${REMOTE_SECRET}`,
  ]);
  if (r.status !== 0) throw new Error(`curl falhou (${r.status}): ${(r.stderr || '').toString().slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

function remotePost(pathName, body) {
  const r = curlImp([
    '-X', 'POST',
    `${REMOTE_HOST}/${REMOTE_DEVICE}/${pathName}`,
    '-H', 'content-type: application/json',
    '-H', `X-Secret-Key: ${REMOTE_SECRET}`,
    '-d', JSON.stringify(body),
  ]);
  if (r.status !== 0) throw new Error(`curl falhou (${r.status}): ${(r.stderr || '').toString().slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------
// Obtém chaves via getwvkeys remote CDM (sem extensão no navegador!)
// ---------------------------------------------------------------------------
async function obterChavesViaAPI(mpdUrl, dtAuthToken, cookies) {
  if (!fs.existsSync(CURL)) {
    console.error('[erro] curl-impersonate não encontrado. Rode: npm run drm:setup');
    process.exit(1);
  }

  // 1. Baixa o MPD e extrai o PSSH (usa curl-impersonate para imitar Chrome)
  log('API-1', 'Baixando MPD e extraindo PSSH...');
  const curlMpdArgs = [
    '--impersonate', 'chrome146',
    '-s', '--compressed', '-m', '30',
    mpdUrl,
    '-H', 'Accept: */*',
    '-H', 'Accept-Language: pt-BR,pt;q=0.9,en;q=0.7',
    '-H', 'Origin: https://play.mercadolivre.com.br',
    '-H', 'Referer: https://play.mercadolivre.com.br/',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  ];
  if (cookies) {
    curlMpdArgs.push('-H', `Cookie: ${cookies}`);
  }
  const mpdRes = curlImp(curlMpdArgs);
  const mpdText = mpdRes.stdout;
  if (mpdRes.status !== 0 || !mpdText || mpdText.length < 100 || /<?xml|<!DOCTYPE/i.test(mpdText.slice(0, 50)) === false) {
    console.error(`[erro] Falha ao baixar o MPD via curl-impersonate.`);
    if (mpdText && mpdText.length < 500) {
      console.error('  Resposta:', mpdText.slice(0, 300));
    }
    console.error('  O link do MPD pode ter EXPIRADO. Pegue um novo no DevTools.');
    console.error('  Dica: copie a URL do MPD E o cookie de sessão ao mesmo tempo.');
    process.exit(1);
  }
  const psshTags = [...mpdText.matchAll(/<cenc:pssh[^>]*>([^<]+)<\/cenc:pssh>/gi)].map((m) => m[1].trim());
  const pssh = psshTags.find((p) => {
    try {
      return Buffer.from(p, 'base64').subarray(12, 28).toString('hex') === 'edef8ba979d64acea3c827dcd51d21ed';
    } catch {
      return false;
    }
  });
  if (!pssh) {
    console.error('[erro] PSSH Widevine não encontrado no MPD.');
    process.exit(1);
  }
  console.log('  ✓ PSSH:', pssh.slice(0, 40) + '...');

  const mpdKids = [...new Set([...mpdText.matchAll(/default_KID="([^"]+)"/gi)].map((m) => m[1].replace(/-/g, '').toLowerCase()))];
  console.log('  KIDs no MPD:', mpdKids.join(', '));

  // 2. Abre sessão no remote CDM e gera o challenge
  log('API-2', 'Abrindo sessão no remote CDM (getwvkeys)...');
  const openResp = remoteGet('open');
  const sessionId = openResp.data?.session_id;
  if (!sessionId) {
    console.error('[erro] open falhou:', JSON.stringify(openResp).slice(0, 300));
    process.exit(1);
  }
  console.log(`  ✓ Sessão: ${String(sessionId).slice(0, 16)}...`);

  console.log('  Gerando challenge...');
  const challengeResp = remotePost('get_license_challenge/STREAMING', {
    session_id: sessionId,
    init_data: pssh,
    privacy_mode: false,
  });
  if (challengeResp.status !== 200) {
    console.error('[erro] Challenge falhou:', JSON.stringify(challengeResp).slice(0, 300));
    process.exit(1);
  }
  const challengeB64 = challengeResp.data?.challenge_b64;
  if (!challengeB64) {
    console.error('[erro] Sem challenge_b64:', JSON.stringify(challengeResp).slice(0, 300));
    process.exit(1);
  }
  console.log('  ✓ Challenge gerado');

  // 3. Envia ao DRMtoday com x-dt-auth-token
  log('API-3', 'Enviando challenge ao license server (DRMtoday)...');
  const challenge = Buffer.from(challengeB64, 'base64');
  const tmp = path.join(ROOT, 'tmp-challenge.bin');
  fs.writeFileSync(tmp, challenge);

  const licHeaders = [
    '-H', 'content-type: application/octet-stream',
    '-H', 'Origin: https://play.mercadolivre.com.br',
    '-H', 'Referer: https://play.mercadolivre.com.br/',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    '-H', `x-dt-auth-token: ${dtAuthToken}`,
  ];

  const lic2 = curlImp([
    '-X', 'POST',
    LICENSE_URL,
    '--data-binary', `@${tmp}`,
    ...licHeaders,
    '-w', '\n%{http_code}',
  ], { raw: true });
  fs.rmSync(tmp, { force: true });

  const licOut = lic2.stdout;
  const nl = licOut.lastIndexOf(0x0a);
  const httpCode = Number(licOut.subarray(nl + 1).toString().trim());
  const licenseData = licOut.subarray(0, nl);

  if (httpCode !== 200 || !licenseData || licenseData.length < 50) {
    console.error(`\n[erro] Licença falhou: HTTP ${httpCode} (${licenseData.length} bytes)`);
    const head = licenseData.subarray(0, 80).toString('utf8').replace(/\s+/g, ' ').trim();
    if (/html|doctype/i.test(head)) {
      console.error('  DRMtoday retornou HTML. Possíveis causas:');
      console.error('    - O x-dt-auth-token expirou (gera um novo no DevTools)');
      console.error('    - O token não corresponde a este vídeo');
    } else {
      console.error('  Resposta:', head.slice(0, 200));
    }
    process.exit(1);
  }
  console.log(`  ✓ Licença recebida (${licenseData.length} bytes)`);

  // 4. Parseia e extrai as chaves
  log('API-4', 'Parseando licença e extraindo chaves...');
  const parseResp = remotePost('parse_license', {
    session_id: sessionId,
    license_message: licenseData.toString('base64'),
  });
  if (parseResp.status !== 200) {
    console.error('[erro] parse_license falhou:', JSON.stringify(parseResp).slice(0, 300));
    process.exit(1);
  }
  console.log('  ✓ Licença parseada');

  const keysResp = remotePost('get_keys/CONTENT', { session_id: sessionId });
  const rawKeys = keysResp.data?.keys ?? keysResp.data ?? keysResp.keys ?? [];

  const pares = [];
  console.log('\n══════════ CHAVES ══════════');
  for (const k of rawKeys) {
    const kid = (k.kid || k.key_id || '').toString().toLowerCase();
    const key = (k.key || '').toString().toLowerCase();
    if (kid && key) {
      const par = `${kid}:${key}`;
      pares.push(par);
      console.log(par);
    }
  }
  console.log('═══════════════════════════');

  if (!pares.length) {
    console.error('\n[erro] Nenhuma chave extraída. Resposta:', JSON.stringify(keysResp).slice(0, 300));
    process.exit(1);
  }
  return pares;
}

// ---------------------------------------------------------------------------
// Executa o download completo: filtra MPD → baixa → descriptografa → muxa
// ---------------------------------------------------------------------------
async function executarDownload({ url, keys, mpdText, audioLang, subLang, nome }) {
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

    if (isSub) return block; // legenda: mantém
    if (!hasCP && blockKids.length === 0) return ''; // anúncio
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

async function main() {
  console.log('');
  console.log(negrito(ciano('============================================')));
  console.log(negrito(ciano('   Mercado Play Downloader (DRM Widevine)')));
  console.log(negrito(ciano('============================================')));
  console.log('');
  console.log(amarelo('Modos disponíveis:'));
  console.log(amarelo('  1. WidevineProxy2 (extensão) — cola MPD + chaves'));
  console.log(amarelo('  2. API getwvkeys (sem extensão) — cola MPD + x-dt-auth-token'));
  console.log(amarelo('  3. Manual — cola MPD + chaves KID:KEY'));
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
  // 2. Fonte das chaves
  // ------------------------------------------------------------------
  let keys = [];

  const chavesJson = chavesDoJsonExportado(url);
  if (chavesJson.length) {
    console.log('');
    console.log(verde(`  🎯 Encontrei as chaves deste vídeo no widevineproxy2-keys.json!`));
    console.log(verde(`  🔑 ${chavesJson.length} chave(s) identificada(s) automaticamente.`));
    const usarAuto = (await pergunta(negrito('Usar essas chaves automaticamente? (S/n):\n> '))).trim().toLowerCase();
    if (usarAuto !== 'n' && usarAuto !== 'nao' && usarAuto !== 'não') {
      keys = chavesJson;
      console.log(verde(`  ✓ ${keys.length} chave(s) carregada(s) do JSON!`));
    }
  }

  if (!keys.length) {
    console.log('');
    console.log(negrito('🔑 Como você quer obter as chaves?'));
    console.log('  [1] Colar chaves KID:KEY manualmente');
    console.log('  [2] Obter via API getwvkeys (precisa do x-dt-auth-token do DevTools)');
    console.log('');

    const fonte = (await pergunta(negrito('Escolha (1 ou 2) [padrão: 1]:\n> '))).trim() || '1';

    if (fonte === '2') {
      console.log('');
      console.log(amarelo('═══ COMO CAPTURAR O x-dt-auth-token ═══'));
      console.log(amarelo('  1. Abra DevTools (F12) → aba Network'));
      console.log(amarelo('  2. DESATIVE a extensão WidevineProxy2'));
      console.log(amarelo('  3. Filtre por "drmtoday"'));
      console.log(amarelo('  4. Reproduza o filme no Mercado Play'));
      console.log(amarelo('  5. Clique na requisição POST para lic.drmtoday.com → Request Headers'));
      console.log(amarelo('  6. Copie o valor de "x-dt-auth-token" (JWT longo)'));
      console.log(amarelo('══════════════════════════════════════════════════════════════════\n'));

      const dtAuthToken = (await pergunta(negrito('🔒 Cole o x-dt-auth-token:\n> '))).trim();
      if (!dtAuthToken) {
        console.log(vermelho('\n❌ Token vazio. Não dá para continuar.'));
        rl.close();
        process.exit(1);
      }
      console.log(verde('  ✓ Token recebido!'));

      console.log('');
      console.log(amarelo('💡 Opcional: cole os cookies de sessão do Mercado Play'));
      console.log(amarelo('   (DevTools → Network → qualquer request → Headers → Cookie)'));
      console.log(amarelo('   Enter vazio para pular.\n'));

      const cookies = (await pergunta(negrito('🍪 Cookies:\n> '))).trim() || '';
      if (cookies) console.log(verde('  ✓ Cookies recebidos!'));
      else console.log(amarelo('  Pulando cookies (pode funcionar sem)'));

      keys = await obterChavesViaAPI(url, dtAuthToken, cookies || null);
      console.log(verde(`\n  ✓ ${keys.length} chave(s) obtida(s) via API!`));
    } else {

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
    }
  }

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

  await executarDownload({ url, keys, mpdText, audioLang, subLang, nome });

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
