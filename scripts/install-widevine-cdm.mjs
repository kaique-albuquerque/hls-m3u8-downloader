/**
 * Extrai o Widevine CDM (widevinecdm.dll) do Chrome/Edge para
 * vendor/widevine-cdm/ (Windows).
 *
 * Uso: npm run cdm:extract
 *
 * O CDM (Content Decryption Module) é necessário para gerar o device do
 * pywidevine, que assina o challenge de licença Widevine (plano DRM, fase 1).
 *
 * Fontes do CDM:
 *  - Google Chrome: C:\Program Files\Google\Chrome\Application\<version>\WidevineCdm\
 *  - Microsoft Edge: C:\Program Files (x86)\Microsoft\Edge\Application\<version>\WidevineCdm\
 *  - Chromium/outros: varia conforme o navegador
 *
 * IMPORTANTE: O CDM contém chaves criptográficas proprietárias. Use apenas
 * para fins educacionais/pessoais. Não distribua o CDM extraído.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor', 'widevine-cdm');
const CDM_DLL = process.platform === 'win32' ? 'widevinecdm.dll' : 'libwidevinecdm.so';
const INSTALLED_MARKER = path.join(VENDOR_DIR, '.installed');

// Caminhos típicos de instalação do CDM por plataforma.
function candidateRoots() {
  const roots = [];
  if (process.platform === 'win32') {
    for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], os.homedir()]) {
      if (!pf) continue;
      roots.push(
        path.join(pf, 'Google', 'Chrome', 'Application'),
        path.join(pf, 'Microsoft', 'Edge', 'Application')
      );
    }
    roots.push(
      path.join(process.env.LocalAppData || '', 'Google', 'Chrome', 'Application'),
      path.join(process.env.LocalAppData || '', 'Microsoft', 'Edge', 'Application')
    );
  } else if (process.platform === 'darwin') {
    roots.push(
      '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Libraries',
      '/Applications/Microsoft Edge.app/Contents/Frameworks/Microsoft Edge Framework.framework/Libraries'
    );
  } else {
    roots.push('/usr/lib/chromium', '/usr/lib/chromium-browser', '/opt/google/chrome');
  }
  return roots;
}

function findCdm() {
  const dllNames = [CDM_DLL];
  for (const root of candidateRoots()) {
    if (!fs.existsSync(root)) continue;
    // <root>/<version>/WidevineCdm/_platform_specific/win_x64/widevinecdm.dll
    const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const entry of entries) {
      const versionDir = path.join(root, entry.name);
      const cdmBase = path.join(versionDir, 'WidevineCdm');
      if (!fs.existsSync(cdmBase)) continue;
      const platformDir = fs.existsSync(path.join(cdmBase, '_platform_specific'))
        ? path.join(cdmBase, '_platform_specific')
        : cdmBase;
      const found = findFileRecursive(platformDir, dllNames);
      if (found) return { cdmPath: found, version: entry.name };
    }
  }
  return null;
}

function findFileRecursive(dir, names) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFileRecursive(p, names);
        if (found) return found;
      } else if (names.includes(entry.name)) {
        return p;
      }
    }
  } catch {
    /* sem permissão ou inexistente */
  }
  return null;
}

console.log('\n[cdm] Procurando Widevine CDM no Chrome/Edge...');

if (fs.existsSync(path.join(VENDOR_DIR, CDM_DLL))) {
  console.log(`[cdm] CDM já instalado em vendor/widevine-cdm/`);
  process.exit(0);
}

const found = findCdm();
if (!found) {
  console.error('[cdm] ✗ Widevine CDM não encontrado nas localizações padrão.');
  console.log('');
  console.log('[cdm] Localize manualmente o widevinecdm.dll:');
  console.log('  1. Abra o Chrome/Edge e visite chrome://components');
  console.log('  2. Verifique que "Widevine Content Decryption Module" está atualizado');
  console.log('  3. Copie o arquivo widevinecdm.dll de:');
  console.log('     C:\\Program Files\\Google\\Chrome\\Application\\<versão>\\WidevineCdm\\_platform_specific\\win_x64\\');
  console.log('  4. Cole em vendor/widevine-cdm/ e crie o arquivo .installed (vazio)');
  process.exit(1);
}

try {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  fs.copyFileSync(found.cdmPath, path.join(VENDOR_DIR, CDM_DLL));
  fs.writeFileSync(INSTALLED_MARKER, new Date().toISOString());
  fs.writeFileSync(path.join(VENDOR_DIR, '.version'), found.version);
  console.log(`[cdm] ✓ CDM extraído (versão ${found.version})`);
  console.log(`[cdm]   Origem: ${found.cdmPath}`);
  console.log(`[cdm]   Destino: ${path.join(VENDOR_DIR, CDM_DLL)}`);
  console.log('[cdm] Lembrete: use apenas para fins educacionais/pessoais.');
} catch (err) {
  console.error(`[cdm] ✗ Falha ao copiar CDM: ${err.message}`);
  process.exit(1);
}
