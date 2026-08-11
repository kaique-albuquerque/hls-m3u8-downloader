// Unit: provider DASH (P3) — detecção de DRM (<ContentProtection>) + analyze.
// Sem rede externa: checkDashDrm por texto; analyze com servidor HTTP local.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { dashProvider } from '../../src/providers/dash/index.js';
import { checkDashDrm } from '../../src/providers/dash/drm.js';
import { UnsupportedDrmError } from '../../src/core/errors.js';

const MPD_CLEAN = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static">
  <Period id="p0">
    <AdaptationSet mimeType="video/mp4" contentType="video" segmentAlignment="true">
      <Representation id="v720" bandwidth="2000000" width="1280" height="720" codecs="avc1.640028">
        <BaseURL>v720.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

// ---- checkDashDrm ----
test('dash drm: manifesto limpo passa', () => {
  assert.equal(checkDashDrm(MPD_CLEAN), false);
  assert.equal(checkDashDrm(''), false);
});

test('dash drm: ContentProtection Widevine lanca UnsupportedDrmError', () => {
  const mpd = MPD_CLEAN.replace(
    '<AdaptationSet mimeType="video/mp4" contentType="video"',
    '<AdaptationSet mimeType="video/mp4" contentType="video"\n<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>'
  );
  assert.throws(() => checkDashDrm(mpd), UnsupportedDrmError);
});

test('dash drm: PlayReady e FairPlay detectados', () => {
  assert.throws(
    () => checkDashDrm(MPD_CLEAN.replace('<Period', '<ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"/><Period')),
    UnsupportedDrmError
  );
  assert.throws(
    () => checkDashDrm(MPD_CLEAN.replace('<Period', '<ContentProtection schemeIdUri="urn:uuid:94ce86fb-07ff-4f43-adb8-93d2fa968ca2"/><Period')),
    UnsupportedDrmError
  );
});

test('dash drm: mp4protection cenc lanca UnsupportedDrmError', () => {
  const mpd = MPD_CLEAN.replace(
    '<AdaptationSet mimeType="video/mp4" contentType="video"',
    '<AdaptationSet mimeType="video/mp4" contentType="video"\n<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>'
  );
  assert.throws(() => checkDashDrm(mpd), UnsupportedDrmError);
});

test('dash drm: erro carrega code UNSUPPORTED_DRM_ERROR', () => {
  try {
    checkDashDrm(MPD_CLEAN.replace('<Period', '<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/><Period'));
    assert.fail('deveria lancar');
  } catch (err) {
    assert.equal(err.code, 'UNSUPPORTED_DRM_ERROR');
    assert.match(err.message, /Widevine/i);
  }
});

// ---- detect ----
test('dash provider: detect reconhece .mpd', () => {
  assert.equal(dashProvider.detect('https://cdn.example.com/manifest.mpd'), true);
  assert.equal(dashProvider.detect('https://cdn.example.com/manifest.mpd?token=abc'), true);
  assert.equal(dashProvider.detect('https://cdn.example.com/index.m3u8'), false);
  assert.equal(dashProvider.detect('https://cdn.example.com/video.mp4'), false);
});

// ---- analyze (servidor local) ----
function withServer(handler, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      fn(`http://127.0.0.1:${port}`)
        .then((result) => {
          server.close();
          resolve(result);
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

test('dash provider: analyze -> MediaInfo com videoRepresentations', async () => {
  const result = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/dash+xml' });
    res.end(MPD_CLEAN);
  }, async (base) => {
    const url = `${base}/manifest.mpd`;
    const info = await dashProvider.analyze({ url });
    assert.equal(info.kind, 'dash');
    assert.equal(info.sourceType, 'dash');
    assert.equal(info.provider, 'dash');
    assert.equal(info.videoRepresentations.length, 1);
    assert.equal(info.videoRepresentations[0].height, 720);
    assert.equal(info.representations.length, 1);
    assert.equal(info.baseUrl, url);
    return info;
  });

  const formats = dashProvider.getFormats(result);
  assert.equal(formats.length, 1);
  assert.equal(formats[0].formatId, 'v720');
  assert.equal(formats[0].url, 'v720.mp4');
  assert.equal(formats[0].hasVideo, true);
  assert.equal(formats[0].hasAudio, false);
});

test('dash provider: analyze com ContentProtection lanca UnsupportedDrmError', async () => {
  const mpd = MPD_CLEAN.replace(
    '<AdaptationSet mimeType="video/mp4" contentType="video"',
    '<AdaptationSet mimeType="video/mp4" contentType="video"\n<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>'
  );
  await assert.rejects(
    withServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/dash+xml' });
      res.end(mpd);
    }, async (base) => dashProvider.analyze({ url: `${base}/drm.mpd` })),
    UnsupportedDrmError
  );
});

test('dash provider: analyze HTTP 404 propaga erro com status', async () => {
  await assert.rejects(
    withServer((req, res) => {
      res.writeHead(404, 'Not Found');
      res.end();
    }, async (base) => dashProvider.analyze({ url: `${base}/missing.mpd` })),
    (err) => err.status === 404
  );
});

test('dash provider: prepareDownload devolve downloadUrl', async () => {
  const plan = await dashProvider.prepareDownload({ url: 'https://cdn.example.com/manifest.mpd' });
  assert.deepEqual(plan, { downloadUrl: 'https://cdn.example.com/manifest.mpd' });
});
