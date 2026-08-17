/**
 * Downloader automatizado do Mercado Play (DRM Widevine).
 *
 * Uso:
 *   node tools/download-mercado-play.mjs "<URL_MPD>" "KID1:KEY1" "KID2:KEY2" [opcoes]
 *
 *   --audio <lang>    Idioma do audio (ex: pt, en, es). Padrao: pt.
 *   --quality <n>     Resolucao maxima (ex: 720). Padrao: melhor disponivel.
 *   --output <dir>    Pasta de saida. Padrao: Downloads do usuario.
 *   --name <nome>     Nome do arquivo final (sem extensao). Padrao: mercadoplay.
 *
 * Fluxo:
 *   1. Baixa o MPD e filtra (remove AdaptationSets com KIDs sem chave + anuncios)
 *   2. N_m3u8DL-RE baixa e descriptografa (mp4decrypt)
 *   3. FFmpeg muxa video + audio em um MP4 final
 *   4. Limpa os intermediarios
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOWNLOADS = path.join(os.homedir(), 'Downloads');

// Caminhos das ferramentas
const NMDL = path.join(ROOT, 'vendor', 'n_m3u8dl-re', 'N_m3u8DL-RE.exe');
const FFMPEG = path.join(ROOT, 'vendor', 'ffmpeg', 'ffmpeg.exe');

// ---------------------------------------------------------------------------
// Parse de argumentos
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const urlIndex = args.findIndex((a) => a.startsWith('http'));
if (urlIndex < 0) {
  console.log('');
  console.log('Uso: node tools/download-mercado-play.mjs "<URL_MPD>" "KID1:KEY1" "KID2:KEY2" [opcoes]');
  console.log('');
  console.log('  <URL_MPD>        URL do Manifest DASH (do WidevineProxy2 -> Manifest copy)');
  console.log('  <KID:KEY>...     Chaves Widevine (do WidevineProxy2 -> Keys copy)');
  console.log('  --audio <lang>   Idioma do audio (pt, en, es). Padrao: pt');
  console.log('  --subs <lang>     Baixa legendas no idioma (pt, en, es). Omita para nao baixar');
  console.log('  --quality <n>    Resolucao maxima (ex: 720). Padrao: melhor');
  console.log('  --output <dir>   Pasta de saida. Padrao: Downloads');
  console.log('  --name <nome>    Nome do arquivo final. Padrao: mercadoplay');
  console.log('');
  console.log('Exemplo:');
  console.log('  node tools/download-mercado-play.mjs "URL_MPD" "KID1:KEY1" "KID2:KEY2"');
  console.log('    --audio pt --subs pt --name csi-miami');
  console.log('');
  process.exit(1);
}

const url = args[urlIndex];

// Flags com valor
const VALUE_FLAGS = new Set(['--audio', '--subs', '--quality', '--output', '--name']);
const keys = [];
let audioLang = 'pt';
let subLang = '';
let quality = '';
let outputDir = DOWNLOADS;
let name = 'mercadoplay';

for (let i = urlIndex + 1; i < args.length; i++) {
  const a = args[i];
  if (VALUE_FLAGS.has(a)) {
    const val = args[++i] || '';
    if (a === '--audio') audioLang = val;
    else if (a === '--subs') subLang = val;
    else if (a === '--quality') quality = val;
    else if (a === '--output') outputDir = val;
    else if (a === '--name') name = val;
  } else if (!a.startsWith('--')) {
    // Valida KID:KEY (32 hex cada) — evita chaves corrompidas passando silenciosamente
    const idx = a.indexOf(':');
    if (idx < 0) continue;
    const kid = a.slice(0, idx).replace(/-/g, '').toLowerCase();
    const key = a.slice(idx + 1).replace(/-/g, '').toLowerCase();
    if (/^[0-9a-f]{32}$/.test(kid) && /^[0-9a-f]{32}$/.test(key)) {
      keys.push(`${kid}:${key}`);
    } else {
      console.error(`[aviso] Chave ignorada (KID ou KEY não é hex de 32): "${a.slice(0, 60)}..."`);
    }
  }
}

if (!keys.length) {
  console.error('[erro] Nenhuma chave KID:KEY válida fornecida.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function run(cmd, argsList, opts = {}) {
  const r = spawnSync(cmd, argsList, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50, ...opts });
  if (r.status !== 0 && opts.allowFail) return r;
  return r;
}

function log(step, msg) {
  console.log(`\n[${step}] ${msg}`);
}

// ---------------------------------------------------------------------------
// 1. Baixa e filtra o MPD
// ---------------------------------------------------------------------------
log('1/5', 'Baixando e filtrando MPD...');
const mpdRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!mpdRes.ok) {
  console.error(`[erro] HTTP ${mpdRes.status} ao baixar o MPD. A URL pode ter expirado — pegue uma nova no navegador.`);
  process.exit(1);
}
const mpdText = await mpdRes.text();

const keyMap = {};
for (const k of keys) {
  const [kid, key] = k.split(':');
  keyMap[kid] = key;
}

// Remove AdaptationSets com KID sem chave OU anúncios (vídeo/áudio sem proteção).
// Legendas (application/*) são mantidas mesmo sem ContentProtection.
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

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpdl-'));
const filteredMpd = path.join(workDir, 'filtered.mpd');
fs.writeFileSync(filteredMpd, filtered);

const remainingKids = [...new Set([...filtered.matchAll(/default_KID="([^"]+)"/gi)].map((m) => m[1].replace(/-/g, '').toLowerCase()))];
log('1/5', `MPD filtrado: ${remainingKids.length} KID(s) com chave (${remainingKids.join(', ')})`);
if (!remainingKids.length) {
  console.error('[erro] Nenhum AdaptationSet restante com chave. Confira os KIDs das chaves coladas.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Baixa com N_m3u8DL-RE
// ---------------------------------------------------------------------------
const keyArgs = keys.flatMap((k) => ['--key', k]);
const svArg = quality ? ['-sv', `res="${quality}"`] : ['-sv', 'best'];
const saArg = ['-sa', `lang=${audioLang}`];
const ssArg = subLang ? ['-ss', `lang=${subLang}`] : [];
const dlDir = path.join(workDir, 'dl');
fs.mkdirSync(dlDir, { recursive: true });

log('2/5', `Baixando com N_m3u8DL-RE (vídeo=${quality || 'best'}, áudio=${audioLang}${subLang ? `, legendas=${subLang}` : ''})...`);
if (!fs.existsSync(NMDL)) {
  console.error('[erro] N_m3u8DL-RE não encontrado em vendor/n_m3u8dl-re/. Rode: npm run drm:setup');
  process.exit(1);
}
const dl = run(NMDL, [filteredMpd, ...keyArgs, ...svArg, ...saArg, ...ssArg, '-M', 'format=mp4', '--save-dir', dlDir], { allowFail: true });
if (dl.status !== 0) {
  console.error('[erro] Download falhou. Saída:');
  console.error((dl.stdout || '').split('\n').slice(-15).join('\n'));
  console.error((dl.stderr || '').split('\n').slice(-15).join('\n'));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Encontra os arquivos baixados
// ---------------------------------------------------------------------------
log('3/5', 'Procurando arquivos baixados...');
const files = fs.readdirSync(dlDir);
const videoFile = files.find((f) => f.endsWith('.mp4'));
const audioFile = files.find((f) => f.endsWith('.m4a'));
const subFile = files.find((f) => /\.(vtt|srt|ass|ssa)$/i.test(f));
if (!videoFile) {
  console.error('[erro] Nenhum arquivo de vídeo gerado.');
  process.exit(1);
}
log('3/5', `Vídeo: ${videoFile} (${(fs.statSync(path.join(dlDir, videoFile)).size / 1024 / 1024).toFixed(0)} MB)`);
if (audioFile) log('3/5', `Áudio: ${audioFile}`);
if (subFile) log('3/5', `Legenda: ${subFile}`);

// ---------------------------------------------------------------------------
// 4. Muxa com FFmpeg
// ---------------------------------------------------------------------------
fs.mkdirSync(outputDir, { recursive: true });
const finalFile = path.join(outputDir, `${name}.mp4`);
log('4/5', `Muxando vídeo + áudio${subFile ? ' + legenda' : ''} → ${finalFile}...`);
const muxArgs = ['-y', '-v', 'error', '-i', path.join(dlDir, videoFile)];
if (audioFile) muxArgs.push('-i', path.join(dlDir, audioFile));
if (subFile) muxArgs.push('-i', path.join(dlDir, subFile));
muxArgs.push('-map', '0:v:0');
if (audioFile) muxArgs.push('-map', '1:a:0');
if (subFile) muxArgs.push('-map', '2:s:0', '-c:s', 'mov_text');
muxArgs.push('-c', 'copy', '-movflags', '+faststart', finalFile);
const mux = run(FFMPEG, muxArgs, { allowFail: true });
if (mux.status !== 0) {
  console.error('[erro] Mux falhou:', (mux.stderr || '').split('\n').slice(-5).join('\n'));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 5. Limpa e conclui
// ---------------------------------------------------------------------------
fs.rmSync(workDir, { recursive: true, force: true });

const sizeMB = (fs.statSync(finalFile).size / 1024 / 1024).toFixed(0);
console.log('');
console.log('==============================================');
console.log(' ✅ DOWNLOAD CONCLUÍDO!');
console.log(` 📁 ${finalFile} (${sizeMB} MB)`);
console.log('==============================================');
