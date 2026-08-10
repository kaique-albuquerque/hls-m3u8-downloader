import vm from 'node:vm';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBalancedBlock(text, startIndex, openChar, closeChar) {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === stringChar) {
        inString = false;
        stringChar = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return '';
}

function extractObjectDefinition(script, objectName) {
  const patterns = [
    new RegExp(`(?:var|let|const)\\s+${escapeRegex(objectName)}\\s*=\\s*\\{`),
    new RegExp(`${escapeRegex(objectName)}\\s*=\\s*\\{`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(script);
    if (!match) continue;
    const braceIndex = script.indexOf('{', match.index);
    const objectLiteral = extractBalancedBlock(script, braceIndex, '{', '}');
    if (objectLiteral) return `var ${objectName}=${objectLiteral};`;
  }
  return '';
}

function extractFunctionDefinition(script, functionName) {
  const expressionPatterns = [
    new RegExp(`${escapeRegex(functionName)}\\s*=\\s*function\\s*\\(([^)]*)\\)\\s*\\{`),
    new RegExp(`(?:var|let|const)\\s+${escapeRegex(functionName)}\\s*=\\s*function\\s*\\(([^)]*)\\)\\s*\\{`),
  ];

  for (const pattern of expressionPatterns) {
    const match = pattern.exec(script);
    if (!match) continue;
    const params = match[1];
    const braceIndex = script.indexOf('{', match.index);
    const body = extractBalancedBlock(script, braceIndex, '{', '}');
    if (body) return `var ${functionName}=function(${params})${body};`;
  }

  const declarationPattern = new RegExp(`function\\s+${escapeRegex(functionName)}\\s*\\(([^)]*)\\)\\s*\\{`);
  const declarationMatch = declarationPattern.exec(script);
  if (declarationMatch) {
    const params = declarationMatch[1];
    const braceIndex = script.indexOf('{', declarationMatch.index);
    const body = extractBalancedBlock(script, braceIndex, '{', '}');
    if (body) return `function ${functionName}(${params})${body}`;
  }

  return '';
}

function findDecipherFunctionName(script) {
  const patterns = [
    /\.sig\|\|([A-Za-z0-9$]+)\(/,
    /signature",([A-Za-z0-9$]+)\(/,
    /\.set\([^,]+,\s*([A-Za-z0-9$]+)\(/,
    /(?:^|[,{;])([A-Za-z0-9$]+)=function\(\w\)\{\w=\w\.split\(""\)/m,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(script);
    if (match) return match[1];
  }
  return '';
}

function findNTransformFunctionName(script) {
  const patterns = [
    /\.get\("n"\)\)&&\(b=([A-Za-z0-9$]+)\(b\)/,
    /\.get\("n"\)\)&&\(.*?=([A-Za-z0-9$]+)\(.*?\)/,
    /(?:^|[;,])([A-Za-z0-9$]+)=function\(\w\)\{var\s+\w=\w\.split\(""\).*?return\s+\w\.join\(""\)\}/m,
    /function\s+([A-Za-z0-9$]+)\(\w\)\{var\s+\w=\w\.split\(""\).*?return\s+\w\.join\(""\)\}/m,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(script);
    if (match) return match[1];
  }
  return '';
}

function findHelperObjectName(functionDefinition) {
  const patterns = [
    /([A-Za-z0-9$]{2,})\.[A-Za-z0-9$]{2,}\(\w,\d+\)/,
    /([A-Za-z0-9$]{2,})\.[A-Za-z0-9$]{2,}\(\w\)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(functionDefinition);
    if (match) return match[1];
  }
  return '';
}

export function extractPlayerJsUrl(html, pageUrl = 'https://www.youtube.com') {
  const text = String(html || '');
  const patterns = [
    /"jsUrl":"([^"]+)"/,
    /"PLAYER_JS_URL":"([^"]+)"/,
    /<script\s+src="([^"]*\/s\/player\/[^"]+base\.js[^"]*)"/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const candidate = match[1].replace(/\\\//g, '/');
    return new URL(candidate, pageUrl).toString();
  }
  return '';
}

export async function fetchPlayerJs(url, headers = {}, timeoutMs = 30000) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': headers['User-Agent'] || headers['user-agent'] || 'Mozilla/5.0',
      ...headers,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

export function decipherYouTubeSignature(signature, playerJsText) {
  const functionName = findDecipherFunctionName(playerJsText);
  if (!functionName) throw new Error('Nao foi possivel localizar a funcao de decipher no player JS do YouTube.');

  return runPlayerFunction(playerJsText, functionName, signature);
}

function runPlayerFunction(playerJsText, functionName, input) {
  const functionDefinition = extractFunctionDefinition(playerJsText, functionName);
  if (!functionDefinition) throw new Error(`Nao foi possivel extrair a funcao ${functionName} do player JS do YouTube.`);

  const helperObjectName = findHelperObjectName(functionDefinition);
  const helperDefinition = helperObjectName ? extractObjectDefinition(playerJsText, helperObjectName) : '';

  const script = [
    helperDefinition,
    functionDefinition,
    `result=${functionName}(${JSON.stringify(input)});`,
  ].filter(Boolean).join('\n');

  const sandbox = { result: '' };
  vm.runInNewContext(script, sandbox, { timeout: 1000 });
  if (!sandbox.result || typeof sandbox.result !== 'string') {
    throw new Error(`A execucao da funcao ${functionName} nao produziu um resultado valido.`);
  }
  return sandbox.result;
}

export function transformYouTubeNParam(nValue, playerJsText) {
  const functionName = findNTransformFunctionName(playerJsText);
  if (!functionName) throw new Error('Nao foi possivel localizar a funcao de transformacao do parametro n no player JS do YouTube.');
  return runPlayerFunction(playerJsText, functionName, nValue);
}

export function applyNTransform(url, playerJsText) {
  const finalUrl = new URL(url);
  const n = finalUrl.searchParams.get('n');
  if (!n) return finalUrl.toString();
  const transformed = transformYouTubeNParam(n, playerJsText);
  finalUrl.searchParams.set('n', transformed);
  return finalUrl.toString();
}

export function applySignatureCipher(cipherText, playerJsText) {
  const params = new URLSearchParams(String(cipherText || ''));
  const rawUrl = params.get('url') || '';
  const signature = params.get('s') || '';
  const signatureParam = params.get('sp') || 'signature';

  if (!rawUrl || !signature) {
    throw new Error('signatureCipher invalido: faltando url ou s.');
  }

  const deciphered = decipherYouTubeSignature(signature, playerJsText);
  const finalUrl = new URL(rawUrl);
  finalUrl.searchParams.set(signatureParam, deciphered);
  return applyNTransform(finalUrl.toString(), playerJsText);
}

export function resolveCipherFormats(formats, playerJsText) {
  return (formats || []).map((format) => {
    if (format.url) {
      try {
        return {
          ...format,
          url: applyNTransform(format.url, playerJsText),
        };
      } catch {
        return format;
      }
    }
    if (!(format.signatureCipher || format.cipher)) return format;
    try {
      return {
        ...format,
        url: applySignatureCipher(format.signatureCipher || format.cipher, playerJsText),
      };
    } catch {
      return format;
    }
  });
}
