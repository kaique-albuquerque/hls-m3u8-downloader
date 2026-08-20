#!/usr/bin/env node
/**
 * Captura chaves Widevine do Mercado Play via Chrome DevTools Protocol (CDP).
 *
 * O browser intercepta o license exchange internamente (EME/CDM) e o JS
 * normal não tem acesso às chaves. Este script conecta ao Chrome via CDP,
 * captura a resposta da licença DRMtoday e envia ao getwvkeys para parse.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * COMO USAR:
 *
 *  1. Feche TODAS as janelas do Chrome
 *  2. Abra o Chrome com depuração remota:
 *
 *     "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
 *
 *     Ou (para não misturar com seu perfil normal):
 *
 *     "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-wv-debug"
 *
 *  3. Navegue até o filme no Mercado Play e comece a reproduzir
 *  4. Em outro terminal, rode:
 *
 *     node tools/capture-wv-keys.mjs
 *
 *  5. As chaves aparecerão no terminal e serão salvas em widevineproxy2-keys.json
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// getwvkeys API
const REMOTE_HOST = 'https://getwvkeys.cc/api/remotecdm/widevine';
const REMOTE_DEVICE = 'getwvkeys';
const REMOTE_SECRET = 'getwvkeys';

const CDP_PORT = 9222;
const CDP_HOST = 'localhost';

// ===========================================================================
// Helpers
// ===========================================================================

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ===========================================================================
// Minimal CDP WebSocket client (Node 22 built-in WebSocket)
// ===========================================================================

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this._id = 0;
    this._pending = new Map(); // id → { resolve, reject }
    this._handlers = new Map(); // method → [fn]
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', (e) => reject(new Error(`CDP connection failed: ${e.message || 'is Chrome running with --remote-debugging-port=9222?'}`)), { once: true });
      this.ws.addEventListener('message', (event) => {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        // Response to a command
        if (msg.id !== undefined && this._pending.has(msg.id)) {
          const p = this._pending.get(msg.id);
          this._pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
          else p.resolve(msg.result);
        }
        // Event notification
        if (msg.method) {
          const fns = this._handlers.get(msg.method);
          if (fns) fns.forEach((fn) => fn(msg.params || {}));
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this._id;
      this._pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      // Timeout after 30s
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`CDP timeout for ${method}`));
        }
      }, 30_000);
    });
  }

  on(method, fn) {
    if (!this._handlers.has(method)) this._handlers.set(method, []);
    this._handlers.get(method).push(fn);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ===========================================================================
// getwvkeys API helpers
// ===========================================================================

function remoteGet(subpath) {
  const url = `${REMOTE_HOST}/${REMOTE_DEVICE}/${subpath}`;
  return new Promise((resolve, reject) => {
    const req = http.get(url, {
      headers: { 'X-Secret-Key': REMOTE_SECRET },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function remotePost(subpath, body) {
  const url = `${REMOTE_HOST}/${REMOTE_DEVICE}/${subpath}`;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Secret-Key': REMOTE_SECRET,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

// ===========================================================================
// Protobuf helpers (minimal — enough for Widevine License)
// ===========================================================================

function readVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  while (offset < buf.length) {
    const b = buf[offset++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: result, offset };
    shift += 7;
    if (shift > 35) break; // 5 bytes max for 32-bit
  }
  return { value: result, offset };
}

function decodeField(buf, offset) {
  if (offset >= buf.length) return null;
  const tag = readVarint(buf, offset);
  const fieldNumber = tag.value >>> 3;
  const wireType = tag.value & 0x07;
  offset = tag.offset;

  switch (wireType) {
    case 0: { // varint
      const v = readVarint(buf, offset);
      return { fieldNumber, wireType, value: v.value, offset: v.offset };
    }
    case 1: { // 64-bit
      const val = buf.readBigUInt64LE(offset);
      return { fieldNumber, wireType, value: val, offset: offset + 8 };
    }
    case 2: { // length-delimited
      const len = readVarint(buf, offset);
      const data = buf.subarray(len.offset, len.offset + len.value);
      return { fieldNumber, wireType, value: data, offset: len.offset + len.value };
    }
    case 5: { // 32-bit
      const val = buf.readUInt32LE(offset);
      return { fieldNumber, wireType, value: val, offset: offset + 4 };
    }
    default:
      return { fieldNumber, wireType, value: null, offset: buf.length };
  }
}

/**
 * Parseia uma mensagem protobuf Widevine License para extrair KIDs e keys.
 *
 * License protobuf:
 *   message License {
 *     message Key {
 *       optional bytes id = 1;    // 16-byte KID
 *       optional bytes data = 3;  // encrypted key data
 *       ...
 *     }
 *     repeated Key key = 1;
 *     ...
 *   }
 */
function parseWvLicense(buf) {
  const keys = [];
  let offset = 0;

  while (offset < buf.length) {
    const field = decodeField(buf, offset);
    if (!field) break;
    offset = field.offset;

    // Field 1 (repeated Key) — length-delimited
    if (field.fieldNumber === 1 && field.wireType === 2) {
      const keyMsg = field.value;
      let kid = null;
      let keyData = null;
      let keyOffset = 0;

      while (keyOffset < keyMsg.length) {
        const inner = decodeField(keyMsg, keyOffset);
        if (!inner) break;
        keyOffset = inner.offset;

        // Key.id (field 1) — 16 bytes
        if (inner.fieldNumber === 1 && inner.wireType === 2 && inner.value.length === 16) {
          kid = Buffer.from(inner.value).toString('hex');
        }
        // Key.data (field 3) — encrypted key (may contain multiple keys)
        if (inner.fieldNumber === 3 && inner.wireType === 2) {
          keyData = inner.value;
        }
      }

      if (kid) {
        keys.push({ kid, keyData });
      }
    }
  }

  return keys;
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Widevine Key Capture via Chrome DevTools Protocol ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // 1. Find Chrome CDP target
  log('CDP', `Conectando ao Chrome na porta ${CDP_PORT}...`);
  let targets;
  try {
    targets = await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json`);
  } catch (e) {
    console.error('');
    console.error('❌ Não foi possível conectar ao Chrome.');
    console.error('');
    console.error('Execute o Chrome com depuração remota:');
    console.error('');
    console.error('  1. Feche TODAS as janelas do Chrome');
    console.error('  2. Abra o CMD/PowerShell e rode:');
    console.error('');
    console.error('     "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222');
    console.error('');
    console.error('  3. Navegue ao Mercado Play e comece o filme');
    console.error('  4. Volte aqui e rode este script novamente');
    console.error('');
    process.exit(1);
  }

  // Find a page target (prefer Mercado Play tab)
  const pages = targets.filter((t) => t.type === 'page');
  if (!pages.length) {
    console.error('❌ Nenhuma aba encontrada no Chrome. Abra pelo menos uma página.');
    process.exit(1);
  }

  const mpPage = pages.find((p) => p.url.includes('mercadolivre') || p.url.includes('mercadoplay'));
  const target = mpPage || pages[0];
  log('CDP', `Alvo: ${target.title || target.url}`);

  if (!mpPage) {
    log('AVISO', 'Nenhuma aba do Mercado Play encontrada. Usando a primeira aba.');
    log('AVISO', 'Certifique-se de que o filme está sendo reproduzido.');
  }

  // 2. Connect via WebSocket
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  log('CDP', 'Conectado!');

  // 3. Enable Network domain
  await cdp.send('Network.enable');
  log('NET', 'Monitoramento de rede ativado');

  console.log('');
  log('AGUARDANDO', 'Aguardando requisição de licença DRMtoday...');
  log('AGUARDANDO', 'Reproduza o filme no Mercado Play se ainda não estiver rodando.');
  console.log('');

  // 4. Set up getwvkeys session proactively
  log('CDM', 'Abrindo sessão no remote CDM (getwvkeys)...');
  let session;
  try {
    const openResp = await remoteGet('open');
    session = openResp.data?.session_id;
    if (!session) throw new Error('No session_id');
    log('CDM', `Sessão: ${String(session).slice(0, 16)}...`);
  } catch (e) {
    log('ERRO', `Falha ao abrir sessão getwvkeys: ${e.message}`);
    log('CDM', 'Continuando sem getwvkeys — tentativa de parse local...');
  }

  // 5. Monitor network for drmtoday responses
  const capturedResponses = [];

  cdp.on('Network.responseReceived', async (params) => {
    const url = params.response?.url || '';
    if (!url.includes('lic.drmtoday.com')) return;

    const requestId = params.requestId;
    log('DRM', `Resposta DRMtoday capturada! (requestId: ${requestId})`);

    // Wait a bit for the response body to be ready
    await new Promise((r) => setTimeout(r, 1000));

    try {
      const { body, base64Encoded } = await cdp.send('Network.getResponseBody', { requestId });
      const rawBody = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body);

      log('DRM', `Resposta: ${rawBody.length} bytes`);
      capturedResponses.push(rawBody);

      // Try getwvkeys parse
      if (session) {
        await tryGetWvKeys(rawBody, session);
      }

      // Also try local protobuf parse (to at least show KIDs)
      const parsed = parseWvLicense(rawBody);
      if (parsed.length > 0) {
        log('PROTO', `Protobuf parse: ${parsed.length} key(s) encontrada(s)`);
        for (const k of parsed) {
          log('PROTO', `  KID: ${k.kid}`);
        }
      }

    } catch (e) {
      log('ERRO', `Falha ao obter body da resposta: ${e.message}`);
    }
  });

  // Also monitor for requestPaused (Fetch domain) as backup
  // to capture the challenge body for replay
  let capturedChallenge = null;
  let capturedHeaders = null;

  try {
    await cdp.send('Network.requestWillBeSent', {}).catch(() => {});
  } catch {}

  cdp.on('Network.requestWillBeSent', (params) => {
    const url = params.request?.url || '';
    if (!url.includes('lic.drmtoday.com')) return;
    if (capturedChallenge) return; // already have one

    log('DRM', 'License request capturada!');
    capturedChallenge = params.request?.postData;
    capturedHeaders = params.request?.headers;

    if (capturedHeaders) {
      const token = capturedHeaders['x-dt-auth-token'] || capturedHeaders['X-Dt-Auth-Token'];
      if (token) log('DRM', `x-dt-auth-token capturado (${token.length} chars)`);
    }
  });

  // 6. Wait for capture (up to 5 minutes)
  const startTime = Date.now();
  const MAX_WAIT = 5 * 60 * 1000;

  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (capturedResponses.length > 0) {
        clearInterval(check);
        resolve();
      }
      if (Date.now() - startTime > MAX_WAIT) {
        clearInterval(check);
        log('TIMEOUT', 'Nenhuma resposta DRMtoday capturada em 5 minutos.');
        resolve();
      }
      // Progress indicator
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed % 15 === 0 && elapsed > 0) {
        process.stdout.write(`\r  ⏳ ${elapsed}s aguardando...`);
      }
    }, 1000);
  });

  console.log('');
  console.log('');

  if (capturedResponses.length === 0) {
    log('FIM', 'Nenhuma licença capturada.');
    log('DICA', 'Certifique-se de que o filme está sendo reproduzido no Chrome.');
    log('DICA', 'O player faz requisições de licença a cada ~15 segundos durante a reprodução.');
  } else {
    log('FIM', `${capturedResponses.length} licença(s) capturada(s).`);

    // Save last response for reference
    const lastResp = capturedResponses[capturedResponses.length - 1];
    const respPath = path.join(ROOT, 'tmp-license-response.bin');
    fs.writeFileSync(respPath, lastResp);
    log('SAVE', `Resposta salva em: ${respPath}`);
  }

  // Try to replay the request if we captured the challenge
  if (capturedChallenge && capturedHeaders) {
    console.log('');
    log('REPLAY', 'Tentando replay da requisição com curl-impersonate...');
    await tryReplayRequest(capturedChallenge, capturedHeaders, session);
  }

  cdp.close();
  console.log('');
  log('DONE', 'Script finalizado.');
}

// ===========================================================================
// Getwvkeys parse attempt
// ===========================================================================

async function tryGetWvKeys(licenseResponse, sessionId) {
  try {
    log('CDM', 'Enviando resposta ao getwvkeys parse_license...');

    const parseResp = await remotePost('parse_license', {
      session_id: sessionId,
      license_message: licenseResponse.toString('base64'),
    });

    if (parseResp.status !== 200 && parseResp.status !== 201) {
      log('CDM', `parse_license retornou: ${JSON.stringify(parseResp).slice(0, 200)}`);

      // Try getting keys anyway — some implementations return keys even on non-200
      const keysResp = await remotePost('get_keys/CONTENT', { session_id: sessionId });
      const rawKeys = keysResp.data?.keys ?? keysResp.data ?? keysResp.keys ?? [];

      if (rawKeys.length > 0) {
        printKeys(rawKeys);
      }
      return;
    }

    log('CDM', 'Licença parseada com sucesso!');

    // Get keys
    const keysResp = await remotePost('get_keys/CONTENT', { session_id: sessionId });
    const rawKeys = keysResp.data?.keys ?? keysResp.data ?? keysResp.keys ?? [];

    if (rawKeys.length > 0) {
      printKeys(rawKeys);
    } else {
      log('CDM', `Resposta get_keys: ${JSON.stringify(keysResp).slice(0, 300)}`);
    }
  } catch (e) {
    log('CDM', `Erro getwvkeys: ${e.message}`);
  }
}

function printKeys(rawKeys) {
  console.log('');
  console.log('═══════════════════ CHAVES CAPTURADAS ═══════════════════');
  const pairs = [];
  for (const k of rawKeys) {
    const kid = (k.kid || k.key_id || '').toString().toLowerCase();
    const key = (k.key || k.k || '').toString().toLowerCase();
    if (kid && key && kid.length === 32 && key.length === 32) {
      const par = `${kid}:${key}`;
      pairs.push(par);
      console.log(`  🔑 ${par}`);
    }
  }
  console.log('═══════════════════════════════════════════════════════════');

  if (pairs.length > 0) {
    // Save to widevineproxy2-keys.json
    saveKeysToJson(pairs);
    // Also save plain text
    fs.writeFileSync(path.join(ROOT, 'chaves.txt'), pairs.join('\n'));
    console.log('');
    log('SAVE', 'Chaves salvas em: chaves.txt e widevineproxy2-keys.json');
    console.log('');
    log('PROXIMO', 'Rode o download:');
    log('PROXIMO', `  npm run drm:mercado-play -- "<URL_MPD>" ${pairs.map((p) => `"${p}"`).join(' ')} --audio pt --name filme`);
  }
}

function saveKeysToJson(pairs) {
  const jsonPath = path.join(ROOT, 'widevineproxy2-keys.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch {}

  // Use first KID as key
  const firstKid = pairs[0]?.split(':')[0];
  if (firstKid) {
    data[firstKid] = {
      keys: pairs.map((p) => {
        const [kid, key] = p.split(':');
        return { kid, k: key };
      }),
      timestamp: Date.now(),
      type: 'WIDEVINE',
      source: 'capture-wv-keys',
    };
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  }
}

// ===========================================================================
// Replay attempt with curl-impersonate
// ===========================================================================

async function tryReplayRequest(challenge, headers, sessionId) {
  const { spawnSync } = await import('node:child_process');
  const CURL = path.join(ROOT, 'tools', 'curl-impersonate.exe');

  if (!fs.existsSync(CURL)) {
    log('REPLAY', 'curl-impersonate não encontrado — replay ignorado.');
    return;
  }

  // Save challenge to temp file
  const tmpChallenge = path.join(ROOT, 'tmp-challenge-replay.bin');
  fs.writeFileSync(tmpChallenge, Buffer.from(challenge, 'utf-8'));

  // Build curl command with same headers
  const args = [
    '--impersonate', 'chrome146',
    '-s', '--compressed', '-m', '30',
    '-X', 'POST',
    'https://lic.drmtoday.com/license-proxy-widevine/cenc/?specConform=true',
    '--data-binary', `@${tmpChallenge}`,
    '-H', 'content-type: application/octet-stream',
    '-H', 'origin: https://play.mercadolivre.com.br',
    '-H', 'referer: https://play.mercadolivre.com.br/',
    '-w', '\n%{http_code}',
  ];

  // Add x-dt-auth-token if captured
  const token = headers['x-dt-auth-token'] || headers['X-Dt-Auth-Token'];
  if (token) {
    args.push('-H', `x-dt-auth-token: ${token}`);
    log('REPLAY', 'x-dt-auth-token incluído no replay');
  }

  try {
    const result = spawnSync(CURL, args, { encoding: null, maxBuffer: 50 * 1024 * 1024 });

    if (result.status !== 0) {
      log('REPLAY', `curl falhou: ${(result.stderr || '').toString().slice(0, 200)}`);
      return;
    }

    const out = result.stdout;
    const nl = out.lastIndexOf(0x0a);
    const httpCode = Number(out.subarray(nl + 1).toString().trim());
    const body = out.subarray(0, nl);

    log('REPLAY', `HTTP ${httpCode} — ${body.length} bytes`);

    if (httpCode === 200 && body.length > 50 && sessionId) {
      log('REPLAY', 'Replay bem-sucedido! Parseando...');
      await tryGetWvKeys(body, sessionId);
    } else if (httpCode !== 200) {
      log('REPLAY', 'DRMtoday rejeitou o replay. Isso é esperado se o CDM remoto é diferente.');
      log('REPLAY', 'As chaves foram capturadas via parse direto acima (se disponível).');
    }
  } finally {
    fs.rmSync(tmpChallenge, { force: true });
  }
}

// ===========================================================================
main().catch((e) => {
  console.error('');
  console.error('❌ Erro fatal:', e.message);
  process.exit(1);
});
