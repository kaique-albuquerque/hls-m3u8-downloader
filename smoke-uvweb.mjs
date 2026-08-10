import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCliSession } from './src/cli-flow.js';

const URL = 'https://vod-uvweb2.329wu3569v.com/vod/E2B0BFF409244817B50635CD3D303F64_media.mp4?content_auth2=/vod/%3Ftag%3Dslb%26host%3Dvod-uvweb2.329wu3569v.com%26app_id%3Dcom.unitv.webs%26trans_id%3Dc5cm6T6OMm_mVTkwx3J6pY%26app_version%3D10102%26client_ip%3D44.204.195.41%26dev_id%3D579c0f1803a7898dfcd681bc20d149ed%26auth_id%3D564571682_com.unitv.webs__0%26user_id%3D564571682%26expired%3D1786409010%26token%3D6634a2c0c396379d50f4426be94c2856&content_license2=tag%3Dslb%26scheme%3Dslb%26app_id%3Dcom.unitv.webs%26media_code%3DE2B0BFF409244817B50635CD3D303F64%26expired%3D1786409010%26token%3D493cd12ff84926c36e059a9914f1e0ea';
const EXPECTED_BYTES = 79863964;
const OUT_DIR = path.join(os.tmpdir(), 'vd-uvweb-test');
fs.mkdirSync(OUT_DIR, { recursive: true });

const answers = {
  async ask(question) {
    if (question.includes('URL do video/playlist')) return URL;
    if (question.includes('Escolha (Enter = melhor disponivel)')) return '';
    if (question.includes('Nome do arquivo')) return 'uvweb-test';
    if (question.includes('Pasta de saida')) return OUT_DIR;
    if (question.includes('(S)obrescrever, (N)ovo nome, (C)ancelar?')) return 'S';
    if (question.includes('Novo nome do arquivo')) return 'uvweb-test';
    if (question.includes('Tentar contornar com curl-impersonate')) return '';
    return '';
  },
};

const result = await runCliSession({
  argv: process.argv.includes('--turbo') ? ['--turbo'] : [],
  projectRoot: process.cwd(),
  answers,
  io: {
    log: (...p) => console.log(...p),
    error: (...p) => console.error(...p),
    onState: () => {},
  },
});

console.log('\n=== RESULTADO ===');
console.log(JSON.stringify({ code: result.code, ok: result.ok, error: result.error || null, output: result.output || null, mode: result.mode || null }));

const outFile = path.join(OUT_DIR, 'uvweb-test.mp4');
if (fs.existsSync(outFile)) {
  const size = fs.statSync(outFile).size;
  const match = Math.abs(size - EXPECTED_BYTES) < 10000 ? 'OK' : `DIVERGENTE (esperado ~${EXPECTED_BYTES})`;
  console.log(`Arquivo: ${outFile}`);
  console.log(`Tamanho: ${size} bytes -> ${match}`);
} else {
  console.log('Arquivo final NAO encontrado.');
}
