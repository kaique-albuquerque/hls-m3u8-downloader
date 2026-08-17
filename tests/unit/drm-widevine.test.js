import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectWidevine,
  extractPsshFromContentProtection,
  extractKidFromTag,
  normalizeKid,
  WidevineHandler,
  WIDEVINE_UUID_URN,
  CLEARKEY_UUID,
} from '../../src/drm/widevine.js';

const SAMPLE_DASH_WIDEVINE = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <ContentProtection schemeIdUri="${WIDEVINE_UUID_URN}" value="Widevine">
        <cenc:pssh>AAAAMnBzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAADoIARIQCHQ2lkVRN2YdvGoXAGNlLRoGY2FzdGxl</cenc:pssh>
      </ContentProtection>
      <Representation id="1" width="1920" height="1080" codecs="avc1.640028"/>
    </AdaptationSet>
  </Period>
</MPD>`;

const SAMPLE_HLS_WIDEVINE = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:6
#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="skd://content",KEYFORMAT="${WIDEVINE_UUID_URN}",KEYFORMATVERSIONS="1"
#EXTINF:6.000,
seg1.m4s
#EXTINF:6.000,
seg2.m4s
`;

const SAMPLE_DASH_CLEARKEY = `<MPD>
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:uuid:${CLEARKEY_UUID}">
        <cenc:pssh>AAAAQ3Bzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAAAZoiQnBzc2gAAAAAmgTweZhAQoarkuZb4IhflQAAAAlJCBzYXJjYXNt</cenc:pssh>
      </ContentProtection>
    </AdaptationSet>
  </Period>
</MPD>`;

test('detectWidevine: DASH com Widevine retorna hasDrm + pssh + kid', () => {
  const result = detectWidevine(SAMPLE_DASH_WIDEVINE);
  assert.ok(result, 'deve detectar Widevine');
  assert.equal(result.hasDrm, true);
  assert.equal(result.method, 'widevine');
  assert.ok(result.pssh, 'deve extrair PSSH');
  assert.match(result.pssh, /^[A-Za-z0-9+/=]+$/);
});

test('detectWidevine: HLS com KEYFORMAT Widevine detecta', () => {
  const result = detectWidevine(SAMPLE_HLS_WIDEVINE);
  assert.ok(result, 'deve detectar Widevine no HLS');
  assert.equal(result.hasDrm, true);
  assert.equal(result.method, 'widevine');
});

test('detectWidevine: ClearKey é identificado como clearkey', () => {
  const result = detectWidevine(SAMPLE_DASH_CLEARKEY);
  assert.ok(result);
  assert.equal(result.hasDrm, true);
  assert.equal(result.method, 'clearkey');
});

test('detectWidevine: conteúdo sem proteção retorna null', () => {
  const plain = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.000,
seg1.ts
`;
  assert.equal(detectWidevine(plain), null);
  assert.equal(detectWidevine('<MPD><Period/></MPD>'), null);
});

test('extractPsshFromContentProtection extrai base64', () => {
  const tag = `<ContentProtection schemeIdUri="${WIDEVINE_UUID_URN}">
    <cenc:pssh>QUJDREVG</cenc:pssh>
  </ContentProtection>`;
  assert.equal(extractPsshFromContentProtection(tag), 'QUJDREVG');
});

test('extractPsshFromContentProtection retorna null sem pssh', () => {
  assert.equal(extractPsshFromContentProtection('<ContentProtection schemeIdUri="x"/>'), null);
});

test('extractKidFromTag extrai default_KID e remove traços', () => {
  const tag = `<ContentProtection schemeIdUri="${WIDEVINE_UUID_URN}" default_KID="01234567-89ab-cdef-0123-456789abcdef">`;
  assert.equal(extractKidFromTag(tag), '0123456789abcdef0123456789abcdef');
});

test('normalizeKid normaliza para hex minúsculo sem traço', () => {
  assert.equal(normalizeKid('01234567-89AB-CDEF-0123-456789abcdef'), '0123456789abcdef0123456789abcdef');
  assert.equal(normalizeKid(''), '');
});

test('WidevineHandler.processEncryptedStream: sem DRM não descriptografa', async () => {
  const handler = new WidevineHandler({ verbose: false });
  const result = await handler.processEncryptedStream({
    manifestText: '#EXTM3U\n#EXTINF:6,\nseg.ts\n',
    encryptedFile: 'a.mp4',
    outputFile: 'b.mp4',
    licenseUrl: 'https://license.example',
  });
  assert.equal(result.decrypted, false);
  assert.equal(result.output, 'a.mp4');
});

test('WidevineHandler.processEncryptedStream: com DRM mas sem licenseUrl lança DrmLicenseError', async () => {
  const handler = new WidevineHandler({ verbose: false });
  await assert.rejects(
    handler.processEncryptedStream({
      manifestText: SAMPLE_DASH_WIDEVINE,
      encryptedFile: 'a.mp4',
      outputFile: 'b.mp4',
      licenseUrl: '',
    }),
    (err) => {
      assert.equal(err.code, 'DRM_LICENSE_ERROR');
      return true;
    }
  );
});
