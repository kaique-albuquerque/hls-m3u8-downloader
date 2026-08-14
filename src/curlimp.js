import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPackagedResourcesPath } from './core/binaries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Perfis imitados pelo curl-impersonate v2.x (curl-impersonate.exe --impersonate <perfil>).
const PROFILE_ORDER = [
  'chrome146', 'chrome145', 'chrome142', 'chrome136', 'chrome133a', 'chrome131',
  'chrome124', 'chrome123', 'chrome120', 'chrome119', 'chrome116', 'chrome110',
  'chrome107', 'chrome104', 'chrome101', 'chrome100', 'chrome99',
  'edge101', 'edge99',
  'firefox147', 'firefox144', 'firefox135', 'firefox133',
  'safari260', 'safari184', 'safari180', 'safari172_ios', 'safari170', 'safari155', 'safari153',
];

// Processos curl em andamento — usados para encerrar tudo no Ctrl+C.
const active = new Set();

function chromeVersion(profile) {
  const m = String(profile || '').match(/chrome(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Localiza um binário do curl-impersonate instalado em:
 *  - PATH do sistema
 *  - pasta tools/ dentro do projeto
 *  - <resourcesPath>/bin (produção empacotada, extraResources)
 *  - %LOCALAPPDATA%\curl-impersonate e %USERPROFILE%\curl-impersonate
 *
 * Formatos suportados:
 *  - v1.x: curl_chromeNNN.exe / curl_edgeNNN.exe (binário standalone)
 *  - v2.x: curl-impersonate.exe + perfis --impersonate (ex.: chrome146)
 *
 * Retorna { cmd, name, profile } (profile é undefined para binários v1.x)
 * ou null.
 */
export function findCurlImpersonate() {
  const dirs = new Set();
  for (const p of (process.env.PATH || '').split(path.delimiter)) {
    if (p.trim()) dirs.add(p.trim());
  }
  dirs.add(path.join(PROJECT_ROOT, 'tools'));
  const packagedRoot = getPackagedResourcesPath();
  if (packagedRoot) dirs.add(path.join(packagedRoot, 'bin'));
  if (process.env.LOCALAPPDATA) dirs.add(path.join(process.env.LOCALAPPDATA, 'curl-impersonate'));
  if (process.env.USERPROFILE) dirs.add(path.join(process.env.USERPROFILE, 'curl-impersonate'));

  const standalone = []; // v1.x: curl_chromeNNN.exe
  let mainExe = null; // v2.x: curl-impersonate.exe
  const profiles = new Set(); // v2.x: perfis disponíveis (curl_chromeNNN.bat etc.)

  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue; // diretório não existe
    }
    for (const name of entries) {
      const lower = name.toLowerCase();
      if (lower === 'curl-impersonate.exe') {
        mainExe = path.join(dir, name);
      } else if (/^curl_(chrome|edge|safari|firefox)\d+(?:_\w+)?\.exe$/i.test(name)) {
        standalone.push(path.join(dir, name));
      } else if (/^curl_(chrome|edge|safari|firefox)\d+(?:_\w+)?\.bat$/i.test(name)) {
        const profile = name.replace(/^curl_/i, '').replace(/\.bat$/i, '');
        if (PROFILE_ORDER.includes(profile)) profiles.add(profile);
      }
    }
  }

  // v2.x (preferido): curl-impersonate.exe + melhor perfil disponível.
  if (mainExe) {
    const profile = PROFILE_ORDER.find((p) => profiles.has(p));
    return { cmd: mainExe, name: 'curl-impersonate.exe', profile };
  }

  // v1.x: binário standalone com a versão do Chrome mais recente.
  standalone.sort((a, b) => {
    const va = chromeVersion(path.basename(a));
    const vb = chromeVersion(path.basename(b));
    return vb - va;
  });

  return standalone.length ? { cmd: standalone[0], name: path.basename(standalone[0]) } : null;
}

/**
 * Encerra todos os processos curl-impersonate ativos (usado no Ctrl+C).
 */
export function killAllCurl() {
  for (const child of active) {
    try {
      child.kill();
    } catch {
      /* ignora */
    }
  }
}

/**
 * Cria um cliente curl-impersonate que já carrega os headers autorizados.
 *
 * Uso:
 *   const client = createCurlClient({ cmd, headers });
 *   const r = await client.fetch(url, outPath);            // baixa para arquivo
 *   const { text, finalUrl } = await client.getText(url);  // baixa e lê texto
 *
 * fetch retorna { ok, code, httpCode, finalUrl, stderr }.
 *
 * Opcoes:
 *  - registerActive: Set<ChildProcess> para registrar processos filhos.
 *    Quando fornecido, os processos sao adicionados a esse Set (em vez do
 *    Set global `active`), permitindo tracking per-instance no transport.
 */
export function createCurlClient({ cmd, headers = {}, profile, registerActive } = {}) {
  const headerArgs = [];
  for (const [k, v] of Object.entries(headers || {})) {
    if (v && String(v).trim()) headerArgs.push('-H', `${k}: ${String(v).trim()}`);
  }

  // v2.x: curl-impersonate.exe --impersonate <perfil> <url> ... --compressed
  const impersonateArgs = profile
    ? ['--impersonate', profile, '--compressed']
    : [];

  // Set alvo para tracking de processos: per-instance quando fornecido,
  // global (`active`) quando nao — preserva comportamento legado.
  const target = registerActive || active;

  function run(url, outPath, timeoutMs) {
    return new Promise((resolve) => {
      const args = [
        ...impersonateArgs,
        url,
        '-sS',
        '-L',
        '--connect-timeout', '15',
        '--max-time', String(Math.max(15, Math.ceil(timeoutMs / 1000))),
        '-w', '%{http_code}\n%{url_effective}',
        '-o', outPath,
        ...headerArgs,
      ];

      let child;
      try {
        child = spawn(cmd, args, { windowsHide: true });
      } catch (err) {
        resolve({ ok: false, code: -1, httpCode: '', finalUrl: '', stderr: String(err.message || err) });
        return;
      }

      target.add(child);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout = (stdout + d.toString()).slice(-4000);
      });
      child.stderr.on('data', (d) => {
        stderr = (stderr + d.toString()).slice(-20000);
      });
      child.on('error', (err) => {
        target.delete(child);
        resolve({ ok: false, code: -1, httpCode: '', finalUrl: '', stderr: String(err.message || err) });
      });
      child.on('close', (code) => {
        target.delete(child);
        const lines = stdout.split(/\r?\n/);
        const httpCode = (lines[0] || '').trim();
        const finalUrl = (lines[1] || '').trim();
        resolve({ ok: code === 0, code, httpCode, finalUrl, stderr });
      });
    });
  }

  return {
    cmd,
    fetch(url, outPath, { timeoutMs = 90000 } = {}) {
      return run(url, outPath, timeoutMs);
    },
    async getText(url, { timeoutMs = 90000 } = {}) {
      const tmp = path.join(os.tmpdir(), `vd-txt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      try {
        const r = await run(url, tmp, timeoutMs);
        if (!r.ok || (r.httpCode && r.httpCode.startsWith('4'))) {
          const err = new Error(`HTTP ${r.httpCode || r.code || 'erro de conexão'}${r.stderr ? ` — ${r.stderr.split('\n').filter(Boolean).slice(-2).join(' ')}` : ''}`);
          err.status = r.httpCode ? Number(r.httpCode) : 0;
          throw err;
        }
        return { text: fs.readFileSync(tmp, 'utf8'), finalUrl: r.finalUrl || url };
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignora */
        }
      }
    },
  };
}
