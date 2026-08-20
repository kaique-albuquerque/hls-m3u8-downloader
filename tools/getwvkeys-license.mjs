/**
 * Obtém chaves Widevine do Mercado Play direto via API do getwvkeys
 * (sem precisar da extensão no navegador!).
 *
 * Fluxo:
 *   1. Baixa o MPD e extrai o PSSH Widevine
 *   2. Gera o challenge no remote CDM do getwvkeys (curl-impersonate p/ Cloudflare)
 *   3. Envia o challenge ao license server DRMtoday
 *   4. Parseia a licença e extrai as chaves KID:KEY
 *
 * Uso:
 *   node tools/getwvkeys-license.mjs "<URL_MPD>" --dt-auth-token <JWT>
 *                                                    [--referer <url>]
 *                                                    [--cookie <valor>]
 *
 *   --dt-auth-token <JWT>  Header x-dt-auth-token (OBRIGATÓRIO p/ DRMtoday do Mercado Play).
 *                          É um JWT que o player gera com userId, sessionId, merchant, etc.
 *   --cookie <valor>       Cookies de sessão do Mercado Play (opcional, mas ajuda com MPD).
 *   --referer <url>        Referer da requisição (padrão: play.mercadolivre.com.br/)
 *
 * Saída: imprime as chaves KID:KEY (uma por linha) e salva em chaves.txt
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * COMO CAPTURAR O x-dt-auth-token:
 *
 *  1. Abra o DevTools (F12) no Chrome → aba Network
 *  2. DESATIVE a extensão WidevineProxy2 (para o player funcionar nativamente)
 *  3. Filtre por "drmtoday" ou "license"
 *  4. Reproduza o filme no Mercado Play
 *  5. Clique na requisição POST para lic.drmtoday.com → Headers (Request)
 *  6. Copie o valor de "x-dt-auth-token" (é um JWT longo)
 *  7. Cole: --dt-auth-token "eyJhbGci..."
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CURL = path.join(ROOT, 'tools', 'curl-impersonate.exe');

const REMOTE_HOST = 'https://getwvkeys.cc/api/remotecdm/widevine';
const REMOTE_DEVICE = 'getwvkeys';
const REMOTE_SECRET = 'getwvkeys';
const LICENSE_URL = 'https://lic.drmtoday.com/license-proxy-widevine/cenc/?specConform=true';
const HEADERS = {
  'Origin': 'https://play.mercadolivre.com.br',
  'Referer': 'https://play.mercadolivre.com.br/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
};

// ---------------------------------------------------------------------------
// Parse de argumentos
// ---------------------------------------------------------------------------
const rawArgs = process.argv.slice(2);
const url = rawArgs.find((a) => a.startsWith('http'));
const flagIndex = (flag) => rawArgs.indexOf(flag);
const flagValue = (flag) => { const i = flagIndex(flag); return i >= 0 && i + 1 < rawArgs.length ? rawArgs[i + 1] : null; };

const dtAuthToken = flagValue('--dt-auth-token');
const referer = flagValue('--referer');
const cookie = flagValue('--cookie');

if (!url) {
  console.error('');
  console.error('Uso: node tools/getwvkeys-license.mjs "<URL_MPD>" --dt-auth-token <JWT> [opcoes]');
  console.error('');
  console.error('  --dt-auth-token <JWT>  Header x-dt-auth-token (OBRIGATORIO p/ DRMtoday)');
  console.error('  --referer <url>        Referer da requisicao (padrao: play.mercadolivre.com.br/)');
  console.error('  --cookie <valor>       Header Cookie');
  console.error('');
  console.error('=== COMO CAPTURAR O x-dt-auth-token ===');
  console.error('  1. Abra DevTools (F12) → aba Network');
  console.error('  2. DESATIVE a extensao WidevineProxy2');
  console.error('  3. Filtre por "drmtoday" ou "license"');
  console.error('  4. Reproduza o filme no Mercado Play');
  console.error('  5. Clique na requisicao POST para lic.drmtoday.com → Headers (Request)');
  console.error('  6. Copie o valor de "x-dt-auth-token" (e um JWT longo)');
  console.error('  7. Cole: --dt-auth-token "eyJhbGci..."');
  console.error('========================================');
  process.exit(1);
}

if (!fs.existsSync(CURL)) {
  console.error('[erro] curl-impersonate não encontrado em tools/. Rode: npm run drm:setup');
  process.exit(1);
}

function curl(args, { raw = false } = {}) {
  const r = spawnSync(CURL, ['--impersonate', 'firefox147', '-s', '--compressed', '-m', '60', ...args], {
    encoding: raw ? null : 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  return r;
}

function remoteGet(pathName) {
  const r = curl([
    `${REMOTE_HOST}/${REMOTE_DEVICE}/${pathName}`,
    '-H', `X-Secret-Key: ${REMOTE_SECRET}`,
  ]);
  if (r.status !== 0) throw new Error(`curl falhou (${r.status}): ${(r.stderr || '').toString().slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

function remotePost(pathName, body) {
  const r = curl([
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
// 1. Baixa o MPD e extrai o PSSH (usa curl-impersonate para imitar Chrome)
// ---------------------------------------------------------------------------
console.log('[1/4] Baixando MPD e extraindo PSSH...');
const curlMpdArgs = [
  '--impersonate', 'chrome146',
  '-s', '--compressed', '-m', '30',
  url,
  '-H', 'Accept: */*',
  '-H', 'Accept-Language: pt-BR,pt;q=0.9,en;q=0.7',
  '-H', 'Origin: https://play.mercadolivre.com.br',
  '-H', 'Referer: https://play.mercadolivre.com.br/',
  '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
];
if (cookie) {
  curlMpdArgs.push('-H', `Cookie: ${cookie}`);
}
const mpdRes = curl(curlMpdArgs);
const mpdText = mpdRes.stdout;
if (mpdRes.status !== 0 || !mpdText || mpdText.length < 100) {
  console.error(`[erro] Falha ao baixar o MPD via curl-impersonate.`);
  if (mpdText && mpdText.length < 500) {
    console.error('  Resposta:', mpdText.slice(0, 300));
  }
  console.error('  O link do MPD pode ter EXPIRADO. Pegue um novo no DevTools.');
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

// KIDs do MPD (para referência)
const mpdKids = [...new Set([...mpdText.matchAll(/default_KID="([^"]+)"/gi)].map((m) => m[1].replace(/-/g, '').toLowerCase()))];
console.log('  KIDs no MPD:', mpdKids.join(', '));

// ---------------------------------------------------------------------------
// 2. Abre sessão no remote CDM (GET /open) e gera o challenge
// ---------------------------------------------------------------------------
console.log('[2/4] Abrindo sessão no remote CDM (getwvkeys)...');
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
  console.error('[erro] Resposta sem challenge_b64:', JSON.stringify(challengeResp).slice(0, 300));
  process.exit(1);
}
console.log('  ✓ Challenge gerado');

// ---------------------------------------------------------------------------
// 3. Envia ao DRMtoday
// ---------------------------------------------------------------------------
console.log('[3/4] Enviando challenge ao license server (DRMtoday)...');
const challenge = Buffer.from(challengeB64, 'base64');
// Grava o challenge em arquivo temporário (curl-impersonate com spawnSync
// não suporta stdin fácil)
const tmp = path.join(ROOT, 'tmp-challenge.bin');
fs.writeFileSync(tmp, challenge);

// Monta headers dinâmicos
const licReferer = referer || HEADERS.Referer;
const licHeaders = [
  '-H', 'content-type: application/octet-stream',
  '-H', `Origin: ${HEADERS.Origin}`,
  '-H', `Referer: ${licReferer}`,
  '-H', `User-Agent: ${HEADERS['User-Agent']}`,
];
if (dtAuthToken) {
  licHeaders.push('-H', `x-dt-auth-token: ${dtAuthToken}`);
  console.log('  ✓ x-dt-auth-token incluído');
}
if (cookie) {
  licHeaders.push('-H', `Cookie: ${cookie}`);
  console.log('  ✓ Cookie incluído');
}

const lic2 = curl([
  '-X', 'POST',
  LICENSE_URL,
  '--data-binary', `@${tmp}`,
  ...licHeaders,
  '-w', '\n%{http_code}',
], { raw: true });
fs.rmSync(tmp, { force: true });

// Extrai o código HTTP da última linha
const licOut = lic2.stdout;
const nl = licOut.lastIndexOf(0x0a);
const httpCode = Number(licOut.subarray(nl + 1).toString().trim());
const licenseData = licOut.subarray(0, nl);

if (httpCode !== 200 || !licenseData || licenseData.length < 50) {
  console.error(`[erro] Licença falhou: HTTP ${httpCode} (${licenseData.length} bytes)`);
  // Mostra mais do corpo da resposta para debug
  const bodyText = licenseData.toString('utf8').replace(/\s+/g, ' ').trim();
  if (/html|doctype|<title/i.test(bodyText)) {
    console.error('  DRMtoday retornou HTML:');
    // Extrai o título ou mensagem de erro do HTML
    const titleMatch = bodyText.match(/<title[^>]*>([^<]+)<\/title>/i);
    const msgMatch = bodyText.match(/<h1[^>]*>([^<]+)<\/h1>/i) || bodyText.match(/<p[^>]*>([^<]+)<\/p>/i);
    if (titleMatch) console.error(`  Título: ${titleMatch[1]}`);
    if (msgMatch) console.error(`  Mensagem: ${msgMatch[1]}`);
    console.error('');
    console.error('  Possíveis causas:');
    console.error('  1. Cookie de sessão do Mercado Play ausente — capture os cookies no DevTools');
    console.error('     (Network → qualquer request → Headers → Cookie) e passe com --cookie');
    console.error('  2. O IP da máquina atual é diferente do IP que gerou o token');
    console.error('  3. O token já não é válido para esta sessão DRMtoday');
  } else {
    console.error('  Resposta:', bodyText.slice(0, 300));
  }
  process.exit(1);
}
console.log(`  ✓ Licença recebida (${licenseData.length} bytes)`);

// ---------------------------------------------------------------------------
// 4. Parseia e extrai as chaves
// ---------------------------------------------------------------------------
console.log('[4/4] Parseando licença e extraindo chaves...');
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
// Formato: { data: { keys: [...] } } ou { data: [...] }
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

// Salva em arquivo
fs.writeFileSync(path.join(ROOT, 'chaves.txt'), pares.join('\n'));
console.log('\n💾 Chaves salvas em: chaves.txt');
console.log('\nAgora rode o download:');
console.log('  npm run drm:mercado-play -- "<URL_MPD>" ' + pares.map((p) => `"${p}"`).join(' ') + ' --audio pt --name filme');
