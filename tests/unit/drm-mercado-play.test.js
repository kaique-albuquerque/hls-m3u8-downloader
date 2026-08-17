import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MercadoPlayDRMHandler,
  isMercadoPlayPlaylistUrl,
  guessLicenseBodyFormat,
  DEFAULT_LICENSE_CANDIDATES,
} from '../../src/drm/mercado-play.js';
import { detectWidevine, WIDEVINE_UUID_URN } from '../../src/drm/widevine.js';
import { createDRMHandler, resolveDRMHandlerForUrl, getDRMHandlerClass, drmHandlers } from '../../src/drm/registry.js';

const MP_DASH_WIDEVINE = `<MPD>
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <ContentProtection schemeIdUri="${WIDEVINE_UUID_URN}">
        <cenc:pssh>QUJDREVGR0hJSktM</cenc:pssh>
      </ContentProtection>
    </AdaptationSet>
  </Period>
</MPD>`;

test('isMercadoPlayPlaylistUrl detecta play.mlstatic.com', () => {
  assert.equal(isMercadoPlayPlaylistUrl('https://video-mpkg-msm-01-vod.play.mlstatic.com/x/index.m3u8'), true);
  assert.equal(isMercadoPlayPlaylistUrl('https://outra.co/playlist.m3u8'), false);
});

test('guessLicenseBodyFormat: URLs de license usam raw body', () => {
  assert.equal(guessLicenseBodyFormat('https://play.mlstatic.com/widevine'), 'raw');
  assert.equal(guessLicenseBodyFormat('https://x/license'), 'raw');
  assert.equal(guessLicenseBodyFormat('https://x/other'), 'json');
});

test('MercadoPlayDRMHandler.detectDRM: Widevine DASH', async () => {
  const handler = new MercadoPlayDRMHandler({ verbose: false });
  const drm = await handler.detectDRM(MP_DASH_WIDEVINE);
  assert.equal(drm.hasDRM, true);
  assert.equal(drm.type, 'widevine');
  assert.equal(drm.pssh, 'QUJDREVGR0hJSktM');
});

test('MercadoPlayDRMHandler.detectDRM: sem proteção', async () => {
  const handler = new MercadoPlayDRMHandler({ verbose: false });
  const drm = await handler.detectDRM('#EXTM3U\n#EXTINF:6,\na.ts\n');
  assert.equal(drm.hasDRM, false);
});

test('MercadoPlayDRMHandler.detectDRM: PlayReady detectado', async () => {
  const handler = new MercadoPlayDRMHandler({ verbose: false });
  const pr = `<MPD><Period><AdaptationSet>
    <ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"/>
  </AdaptationSet></Period></MPD>`;
  const drm = await handler.detectDRM(pr);
  assert.equal(drm.hasDRM, true);
  assert.equal(drm.type, 'playready');
});

test('resolveLicenseServer: usa o configurado, depois hint, depois candidatos', () => {
  const handler = new MercadoPlayDRMHandler({ licenseServer: 'https://meu-license.example' });
  assert.equal(handler.resolveLicenseServer('https://hint'), 'https://meu-license.example');

  const handler2 = new MercadoPlayDRMHandler({});
  assert.equal(handler2.resolveLicenseServer('https://hint'), 'https://hint');
  assert.equal(handler2.resolveLicenseServer(''), DEFAULT_LICENSE_CANDIDATES[0]);
});

test('registry: getDRMHandlerClass e createDRMHandler', () => {
  assert.equal(getDRMHandlerClass('mercadoplay'), MercadoPlayDRMHandler);
  assert.equal(getDRMHandlerClass('MERCADOPLAY'), MercadoPlayDRMHandler);
  assert.equal(getDRMHandlerClass('widevine'), drmHandlers.widevine);
  assert.equal(getDRMHandlerClass('desconhecido'), drmHandlers.widevine);

  const handler = createDRMHandler('mercadoplay', { verbose: false });
  assert.ok(handler instanceof MercadoPlayDRMHandler);
});

test('registry: resolveDRMHandlerForUrl escolhe handler por URL', () => {
  const mp = resolveDRMHandlerForUrl('https://play.mlstatic.com/x/index.m3u8');
  assert.ok(mp instanceof MercadoPlayDRMHandler);

  const wv = resolveDRMHandlerForUrl('https://outra.co/x/index.m3u8');
  assert.equal(wv.constructor.name, 'WidevineHandler');
});

test('MercadoPlayDRMHandler: processEncryptedStream com PlayReady lança erro claro', async () => {
  const handler = new MercadoPlayDRMHandler({ verbose: false, licenseServer: 'https://lic.example' });
  const pr = `<MPD><Period><AdaptationSet>
    <ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"/>
  </AdaptationSet></Period></MPD>`;
  await assert.rejects(
    handler.processEncryptedStream({ manifestText: pr, encryptedFile: 'a.mp4', outputFile: 'b.mp4' }),
    (err) => err.code === 'DRM_LICENSE_ERROR'
  );
});

test('MercadoPlayDRMHandler: processEncryptedStream sem DRM retorna arquivo original', async () => {
  const handler = new MercadoPlayDRMHandler({ verbose: false });
  const result = await handler.processEncryptedStream({
    manifestText: '#EXTM3U\n#EXTINF:6,\na.ts\n',
    encryptedFile: 'a.mp4',
    outputFile: 'b.mp4',
  });
  assert.equal(result.decrypted, false);
  assert.equal(result.output, 'a.mp4');
});

test('MercadoPlayDRMHandler: chaves manuais pulam a licença (sem device)', async () => {
  const handler = new MercadoPlayDRMHandler({ verbose: false, licenseServer: 'https://lic.example' });
  // decrypt() falha no spawn real — mas o erro deve ser de mp4decrypt,
  // NÃO de licença/device. Isso prova que as chaves manuais pularam o pywidevine.
  await assert.rejects(
    handler.processEncryptedStream({
      manifestText: MP_DASH_WIDEVINE,
      encryptedFile: 'a.mp4',
      outputFile: 'b.mp4',
      keys: [{ kid: '0123456789abcdef0123456789abcdef', key: '00112233445566778899aabbccddeeff' }],
    }),
    (err) => {
      assert.notEqual(err.code, 'DRM_LICENSE_ERROR', 'não deve pedir licença com chaves manuais');
      return true;
    }
  );
});

test('detectWidevine continua funcional para o provider (integração)', () => {
  const wv = detectWidevine(MP_DASH_WIDEVINE);
  assert.ok(wv?.hasDrm);
});
