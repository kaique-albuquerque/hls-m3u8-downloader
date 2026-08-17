# Obter chaves do Mercado Play via remote CDM do getwvkeys (sem navegador!)
# Replica o protocolo que o WidevineProxy2 usa (pywidevine serve antigo).
# Uso: python getwvkeys-keys.py <pssh_data_base64>
# Exemplo: python getwvkeys-keys.py "CAESECjpXXqcQTOWr5ar3o2FcOk..."

import os
import sys
import base64
import json
import urllib.request
import urllib.error

# Config do remote CDM do getwvkeys (sem verificação, do fórum)
REMOTE_HOST = "https://getwvkeys.cc/api/remotecdm/widevine"
REMOTE_SECRET = "getwvkeys"
REMOTE_DEVICE = "getwvkeys"

# License server do Mercado Play (DRMtoday)
LICENSE_URL = "https://lic.drmtoday.com/license-proxy-widevine/cenc/?specConform=true"

# Headers da sessão (do JSON exportado do WVP2)
HEADERS = {
    "Origin": "https://play.mercadolivre.com.br",
    "Referer": "https://play.mercadolivre.com.br/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
}


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def remote_post(path: str, body: dict):
    """POST para o remote CDM (protocolo pywidevine serve 1.9)."""
    url = f"{REMOTE_HOST}/{REMOTE_DEVICE}/{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"content-type": "application/json", "X-Secret-Key": REMOTE_SECRET},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def main():
    if len(sys.argv) < 2:
        print("Uso: python getwvkeys-keys.py <pssh_data_base64>")
        sys.exit(1)

    pssh_b64 = sys.argv[1]
    session_id = os.urandom(16)
    session_hex = session_id.hex()
    print(f"[1] Remote CDM: {REMOTE_HOST}/{REMOTE_DEVICE}")
    print(f"[2] Sessão: {session_hex[:16]}...")

    print("[3] Gerando challenge...")
    resp = remote_post("get_license_challenge/STREAMING", {
        "session_id": session_hex,
        "init_data": pssh_b64,
        "privacy_mode": False,
    })
    if resp.get("status") != 200:
        print(f"    ❌ {resp}")
        sys.exit(1)
    challenge_b64 = resp["data"]["challenge_b64"]
    print(f"    Challenge gerado ({len(challenge_b64)} chars base64)")

    print("[4] Enviando challenge ao DRMtoday...")
    challenge = base64.b64decode(challenge_b64)
    req = urllib.request.Request(LICENSE_URL, data=challenge, method="POST")
    for k, v in HEADERS.items():
        req.add_header(k, v)
    req.add_header("Content-Type", "application/octet-stream")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            license_data = resp.read()
    except urllib.error.HTTPError as e:
        print(f"    ❌ HTTP {e.code}: {e.read().decode(errors='replace')[:300]}")
        sys.exit(1)
    print(f"    Licença recebida: {len(license_data)} bytes")

    print("[5] Enviando licença ao remote CDM para extrair chaves...")
    parse_resp = remote_post("parse_license", {
        "session_id": session_hex,
        "license_message": b64(license_data),
    })
    if parse_resp.get("status") != 200:
        print(f"    ❌ parse_license: {parse_resp}")
        sys.exit(1)

    print("[6] Obtendo chaves...")
    keys_resp = remote_post("get_keys/CONTENT", {"session_id": session_hex})
    keys = keys_resp.get("data", keys_resp)

    print("\n=== CHAVES OBTIDAS ===")
    if isinstance(keys, list):
        for k in keys:
            kid = k.get("kid", k.get("key_id", ""))
            key = k.get("key", "")
            print(f"{kid}:{key}")
    else:
        print(json.dumps(keys, indent=2))
    print("======================")


if __name__ == "__main__":
    main()
