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
 *   node tools/getwvkeys-license.mjs "<URL_MPD>"
 *
 * Saída: imprime as chaves KID:KEY (uma por linha) e salva em chaves.txt
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

const url = process.argv[2];
if (!url?.startsWith('http')) {
  console.error('Uso: node tools/getwvkeys-license.mjs "<URL_MPD>"');
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
// 1. Baixa o MPD e extrai o PSSH
// ---------------------------------------------------------------------------
console.log('[1/4] Baixando MPD e extraindo PSSH...');
const mpdRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!mpdRes.ok) {
  console.error(`[erro] HTTP ${mpdRes.status} — link pode ter expirado. Pegue um novo.`);
  process.exit(1);
}
const mpdText = await mpdRes.text();
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
const lic2 = curl([
  '-X', 'POST',
  LICENSE_URL,
  '--data-binary', `@${tmp}`,
  '-H', 'content-type: application/octet-stream',
  '-H', `Origin: ${HEADERS.Origin}`,
  '-H', `Referer: ${HEADERS.Referer}`,
  '-H', `User-Agent: ${HEADERS['User-Agent']}`,
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
  const head = licenseData.subarray(0, 80).toString('utf8').replace(/\s+/g, ' ').trim();
  if (/html|doctype/i.test(head)) {
    console.error('  O DRMtoday retornou uma página HTML — possível bloqueio/erro no license server.');
    console.error('  Dica: pode ser que o vídeo exija um cabeçalho específico (token, dt-custom-data)');
  } else {
    console.error('  Resposta:', head.slice(0, 200));
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
