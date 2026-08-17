/**
 * P1-DRM — Wrapper do pywidevine (src/drm/pywidevine-wrapper.js)
 *
 * O pywidevine (Python) é a ferramenta mais madura para aquisição de
 * licenças Widevine L3: carrega um device (CDM extraído), gera o challenge,
 * envia ao license server e extrai as chaves KID:KEY.
 *
 * Este wrapper chama o pywidevine via subprocess (script Python inline)
 * para não adicionar dependência nativa ao pacote Node. O script:
 *
 *   1. Carrega o device (.wvd) — gerado a partir do widevinecdm.dll
 *   2. Gera o challenge a partir do PSSH
 *   3. Envia o challenge ao license server (POST, headers customizáveis)
 *   4. Parseia a licença e imprime as chaves KID:KEY em JSON
 *
 * Requisitos (fase 1 do plano):
 *   - Python 3.10+ no PATH
 *   - `pip install pywidevine requests` (ou pywidevine apenas)
 *   - device .wvd em vendor/widevine-cdm/device.wvd
 *
 * Geração do device (uma vez):
 *   pywidevine create-device -k vendor/widevine-cdm/widevinecdm.dll \
 *     -t "CHROME" -l 3 -o vendor/widevine-cdm/device.wvd
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DEVICE = path.join(PROJECT_ROOT, 'vendor', 'widevine-cdm', 'device.wvd');

/** Script Python executado pelo wrapper (mantido inline para portabilidade). */
export const PYWV_PYTHON_SCRIPT = String.raw`
import sys, json, base64
from pywidevine.cdm import Cdm
from pywidevine.device import Device
from pywidevine.pssh import PSSH

def main():
    args = json.loads(sys.argv[1])
    device_path = args["device"]
    pssh_b64 = args["pssh"]
    license_url = args["license_url"]
    headers = args.get("headers", {})
    raw_body = args.get("raw_body", False)

    device = Device.load(device_path)
    cdm = Cdm.from_device(device)
    session_id = cdm.open()
    try:
        challenge = cdm.get_license_challenge(session_id, PSSH(pssh_b64))
        if raw_body:
            body = challenge
        else:
            body = json.dumps({"challenge": base64.b64encode(challenge).decode()}).encode()

        import urllib.request
        req = urllib.request.Request(license_url, data=body, method="POST")
        for k, v in headers.items():
            req.add_header(k, v)
        req.add_header("Content-Type", "application/json" if not raw_body else "application/octet-stream")
        with urllib.request.urlopen(req, timeout=30) as resp:
            license_data = resp.read()

        cdm.parse_license(session_id, license_data)
        keys = []
        for key in cdm.get_keys(session_id):
            if key.type == "CONTENT":
                keys.append({
                    "kid": key.kid.hex,
                    "key": key.key.hex(),
                    "type": str(key.type),
                })
        print(json.dumps({"keys": keys}))
    finally:
        cdm.close(session_id)

if __name__ == "__main__":
    main()
`;

/**
 * Executa o pywidevine via Python e retorna as chaves.
 *
 * @param {object} opts
 * @param {string} opts.pssh — PSSH em base64.
 * @param {string} opts.licenseUrl — URL do license server.
 * @param {object} [opts.headers] — headers extras da requisição de licença.
 * @param {string} [opts.devicePath] — caminho do device .wvd.
 * @param {boolean} [opts.rawBody] — envia o challenge como body bruto
 *   (application/octet-stream) em vez de JSON { challenge }.
 * @param {string} [opts.python] — binário Python (default: python).
 * @param {number} [opts.timeoutMs] — timeout do processo.
 * @returns {Promise<Array<{kid: string, key: string, type: string}>>}
 */
export async function acquireKeysWithPywidevine({
  pssh,
  licenseUrl,
  headers = {},
  devicePath = DEFAULT_DEVICE,
  rawBody = false,
  python = 'python',
  timeoutMs = 60_000,
} = {}) {
  if (!pssh) throw new Error('PSSH obrigatório para aquisição de licença Widevine.');
  if (!licenseUrl) throw new Error('licenseUrl obrigatória para aquisição de licença Widevine.');
  if (!fs.existsSync(devicePath)) {
    throw new Error(
      `Device Widevine não encontrado em ${devicePath}. ` +
      'Extraia o CDM (npm run cdm:extract) e gere o device: ' +
      'pywidevine create-device -k vendor/widevine-cdm/widevinecdm.dll -t "CHROME" -l 3 -o vendor/widevine-cdm/device.wvd'
    );
  }

  const payload = {
    device: devicePath,
    pssh,
    license_url: licenseUrl,
    headers,
    raw_body: Boolean(rawBody),
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(python, ['-c', PYWV_PYTHON_SCRIPT, JSON.stringify(payload)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('pywidevine excedeu o timeout de aquisição de licença.'));
    }, timeoutMs);

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`pywidevine falhou (código ${code}): ${stderr.trim() || 'sem saída'}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(Array.isArray(parsed.keys) ? parsed.keys : []);
      } catch {
        reject(new Error(`pywidevine retornou saída inválida: ${stdout.trim()}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Falha ao executar Python (${python}): ${err.message}. Instale o Python 3.10+ e rode: pip install pywidevine`));
    });
  });
}

/** Verifica se o device .wvd existe (sem lançar). */
export function hasWidevineDevice(devicePath = DEFAULT_DEVICE) {
  return fs.existsSync(devicePath);
}

/** Caminho padrão do device Widevine. */
export function getDefaultWidevineDevicePath() {
  return DEFAULT_DEVICE;
}
