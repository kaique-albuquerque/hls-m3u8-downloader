/**
 * Filtra um MPD do Mercado Play (SSAI multi-período), removendo:
 *  1. AdaptationSets com KIDs que NÃO temos chave (evita erro do FFmpeg/mp4decrypt)
 *  2. AdaptationSets sem ContentProtection (anúncios SSAI)
 *
 * Uso: node tools/filter-mpd.mjs <url_mpd> <kid1:key1> [kid2:key2 ...] [--out arquivo.mpd]
 *
 * Exemplo:
 *   node tools/filter-mpd.mjs "https://.../index.mpd" \
 *     "5dc26456869637ca80bd0da7997b18c5:de600a57dde164ccf1e6d43bb55632d8" \
 *     "28e95d7a9c413396af96abde8d8570e9:bf2fe6c945f8913c1c9f5690cc58956d" \
 *     --out csi-filtrado.mpd
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const urlIndex = args.findIndex((a) => a.startsWith('http'));
if (urlIndex < 0) {
  console.error('Uso: node tools/filter-mpd.mjs <url_mpd> <kid1:key1> [kid2:key2...] [--out arquivo.mpd]');
  process.exit(1);
}

const url = args[urlIndex];

// Chaves: kid:key após a URL
const keysArg = args.slice(urlIndex + 1).filter((a) => !a.startsWith('--'));
const keys = {};
for (const k of keysArg) {
  const [kid, key] = k.split(':');
  if (kid && key) keys[kid.replace(/-/g, '').toLowerCase()] = key;
}

const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : 'tmp-filtered.mpd';

console.log(`[filter-mpd] Baixando MPD: ${url.slice(0, 80)}...`);
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!res.ok) {
  console.error(`[filter-mpd] HTTP ${res.status} ao baixar o MPD`);
  process.exit(1);
}
const text = await res.text();
console.log(`[filter-mpd] MPD original: ${text.length} bytes, ${(text.match(/<AdaptationSet/g) || []).length} AdaptationSets`);

// Coleta todos os KIDs do MPD
const allKids = [...new Set([...text.matchAll(/default_KID="([^"]+)"/gi)].map((m) => m[1].replace(/-/g, '').toLowerCase()))];
console.log(`[filter-mpd] KIDs no MPD: ${allKids.join(', ') || '(nenhum)'}`);
console.log(`[filter-mpd] Chaves fornecidas: ${Object.keys(keys).join(', ') || '(nenhuma!)'}`);

// Remove AdaptationSets com KID sem chave OU anúncios (vídeo/áudio sem proteção).
// Legendas (application/*) são mantidas mesmo sem ContentProtection.
let filtered = text.replace(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi, (block, attrs, inner) => {
  const blockKids = [...new Set([...block.matchAll(/default_KID="([^"]+)"/gi)].map((m) => m[1].replace(/-/g, '').toLowerCase()))];
  const hasCP = /<ContentProtection/i.test(block);
  const mime = /mimeType="([^"]+)"/i.exec(attrs)?.[1] || '';
  const isSub = mime.startsWith('application/') || /contentType="(text|subtitle)"/i.test(attrs);

  if (isSub) return block; // legenda: mantém
  if (!hasCP && blockKids.length === 0) {
    console.log(`  - remover: AdaptationSet sem proteção (anúncio)`);
    return '';
  }
  if (blockKids.some((k) => k && !keys[k])) {
    console.log(`  - remover: AdaptationSet KIDs=[${blockKids.join(', ')}] (sem chave)`);
    return '';
  }
  return block;
});

fs.writeFileSync(outFile, filtered);
console.log(`\n[filter-mpd] ✓ MPD filtrado: ${outFile} (${filtered.length} bytes)`);

// Resumo final
const remaining = (filtered.match(/<AdaptationSet/g) || []).length;
const remainingKids = [...new Set([...filtered.matchAll(/default_KID="([^"]+)"/gi)].map((m) => m[1].replace(/-/g, '').toLowerCase()))];
console.log(`[filter-mpd] AdaptationSets restantes: ${remaining}`);
console.log(`[filter-mpd] KIDs restantes: ${remainingKids.join(', ') || '(nenhum)'}`);
console.log(`\nPróximo passo: N_m3u8DL-RE "${outFile}" --key ... -sv best -sa lang=pt -M format=mp4`);
