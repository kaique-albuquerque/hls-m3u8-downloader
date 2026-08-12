import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDuration,
  estimateSizeBytes,
  normalizeVariantToFormat,
  normalizeRepresentationToFormat,
  normalizeMediaInfo,
  emptyMediaInfo,
} from '../../electron/media-info.js';

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

test('formatDuration formata segundos em H:MM:SS / MM:SS', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(59), '0:59');
  assert.equal(formatDuration(60), '1:00');
  assert.equal(formatDuration(125), '2:05');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(7325), '2:02:05');
  assert.equal(formatDuration(-5), '0:00');
  assert.equal(formatDuration(NaN), '0:00');
  assert.equal(formatDuration(null), '0:00');
});

// ---------------------------------------------------------------------------
// estimateSizeBytes
// ---------------------------------------------------------------------------

test('estimateSizeBytes calcula bitrate * duração / 8', () => {
  assert.equal(estimateSizeBytes(2_000_000, 60), 15_000_000); // ~14,3 MB
  assert.equal(estimateSizeBytes(0, 60), 0);
  assert.equal(estimateSizeBytes(2_000_000, 0), 0);
  assert.equal(estimateSizeBytes(-1, 60), 0);
});

// ---------------------------------------------------------------------------
// normalizeVariantToFormat (HLS master / ytdlp variants)
// ---------------------------------------------------------------------------

test('normalizeVariantToFormat mapeia variante legada para Format', () => {
  const f = normalizeVariantToFormat(
    {
      uri: 'https://cdn/video/1080.m3u8',
      resolution: '1920x1080',
      width: 1920,
      height: 1080,
      bandwidth: 5_000_000,
      codecs: 'avc1.640028,mp4a.40.2',
      container: 'mp4',
      itag: '137',
    },
    0
  );
  assert.equal(f.id, '137');
  assert.equal(f.resolution, '1920x1080');
  assert.equal(f.videoCodec, 'avc1.640028');
  assert.equal(f.audioCodec, 'mp4a.40.2');
  assert.equal(f.container, 'mp4');
  assert.equal(f.bitrate, 5_000_000);
  assert.equal(f.bitrateLabel, '5.00 Mbps');
  assert.equal(f.hasVideo, true);
  assert.equal(f.hasAudio, true);
  assert.equal(f.url, 'https://cdn/video/1080.m3u8');
  assert.equal(f.legacyIndex, 0);
});

test('normalizeVariantToFormat lida com campos ausentes', () => {
  const f = normalizeVariantToFormat({ uri: 'https://cdn/v.m3u8' }, 2);
  assert.equal(f.id, 'f3');
  assert.equal(f.resolution, 'Auto');
  assert.equal(f.bitrate, 0);
  assert.equal(f.bitrateLabel, '');
  assert.equal(f.videoCodec, '');
  assert.equal(f.hasAudio, true); // sourceKind ausente => assume progressivo
  assert.equal(f.legacyIndex, 2);
});

test('normalizeVariantToFormat: variante adaptativa sem áudio', () => {
  const f = normalizeVariantToFormat({ uri: 'x', sourceKind: 'adaptive', height: 720 }, 1);
  assert.equal(f.hasAudio, false);
  assert.equal(f.resolution, '720p');
});

// ---------------------------------------------------------------------------
// normalizeRepresentationToFormat (DASH)
// ---------------------------------------------------------------------------

test('normalizeRepresentationToFormat mapeia representação DASH', () => {
  const f = normalizeRepresentationToFormat(
    { id: 'video-1', width: 1280, height: 720, bandwidth: 2_500_000, codecs: 'avc1.4d401f', baseUrl: 'seg/720.mp4' },
    0
  );
  assert.equal(f.id, 'video-1');
  assert.equal(f.resolution, '1280x720');
  assert.equal(f.bitrate, 2_500_000);
  assert.equal(f.container, 'mp4');
  assert.equal(f.hasVideo, true);
  assert.equal(f.hasAudio, true);
});

// ---------------------------------------------------------------------------
// normalizeMediaInfo
// ---------------------------------------------------------------------------

test('normalizeMediaInfo: HLS master com variantes + tamanho estimado', () => {
  const raw = {
    kind: 'master',
    title: 'Filme Teste',
    variants: [
      { uri: 'https://cdn/1080.m3u8', resolution: '1920x1080', height: 1080, bandwidth: 5_000_000, codecs: 'avc1' },
      { uri: 'https://cdn/720.m3u8', resolution: '1280x720', height: 720, bandwidth: 2_500_000, codecs: 'avc1' },
    ],
    baseUrl: 'https://cdn/',
  };
  const media = normalizeMediaInfo(raw, { url: 'https://example.com/master.m3u8', sourceType: 'hls', provider: 'hls' });
  assert.equal(media.title, 'Filme Teste');
  assert.equal(media.sourceType, 'hls');
  assert.equal(media.protocol, 'HLS');
  assert.equal(media.provider, 'hls');
  assert.equal(media.duration, 0);
  assert.equal(media.formats.length, 2);
  assert.equal(media.best.resolution, '1920x1080');
  assert.equal(media.formats[0].estimatedSize, 0); // sem duração
});

test('normalizeMediaInfo: HLS master com duração calcula tamanho estimado', () => {
  const raw = {
    kind: 'master',
    title: 'Filme',
    durationSeconds: 120,
    variants: [{ uri: 'x', resolution: '1920x1080', height: 1080, bandwidth: 2_000_000 }],
  };
  const media = normalizeMediaInfo(raw, { sourceType: 'hls' });
  assert.equal(media.durationLabel, '2:00');
  assert.equal(media.formats[0].estimatedSize, 30_000_000);
  assert.ok(media.estimatedSizeLabel);
  assert.equal(media.bitrate, 2_000_000);
  assert.equal(media.bitrateLabel, '2.00 Mbps');
});

test('normalizeMediaInfo: DASH com representações', () => {
  const raw = {
    kind: 'dash',
    title: '',
    videoRepresentations: [
      { id: 'v1', width: 1920, height: 1080, bandwidth: 6_000_000, codecs: 'avc1', baseUrl: 'seg/1080' },
    ],
    baseUrl: 'https://cdn/manifest/',
  };
  const media = normalizeMediaInfo(raw, { url: 'https://example.com/manifest.mpd', sourceType: 'dash', provider: 'dash' });
  assert.equal(media.kind, 'dash');
  assert.equal(media.protocol, 'DASH');
  assert.equal(media.formats.length, 1);
  assert.equal(media.formats[0].resolution, '1920x1080');
  assert.equal(media.best.resolution, '1920x1080');
  assert.equal(media.baseUrl, 'https://cdn/manifest/');
});

test('normalizeMediaInfo: ytdlp com título, thumbnail e variants', () => {
  const raw = {
    kind: 'ytdlp',
    title: 'Vídeo do YouTube',
    pageUrl: 'https://www.youtube.com/watch?v=abc',
    durationSeconds: 300,
    thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
    variants: [
      { uri: 'https://cdn/v.mp4', resolution: '1920x1080', height: 1080, bandwidth: 4_000_000, codecs: 'avc1,mp4a', itag: '137', container: 'mp4', sourceKind: 'progressive' },
      { uri: 'ytdlp-format:136', resolution: '1280x720', height: 720, bandwidth: 2_000_000, codecs: 'avc1', itag: '136', container: 'mp4', sourceKind: 'adaptive' },
    ],
  };
  const media = normalizeMediaInfo(raw, { url: 'https://www.youtube.com/watch?v=abc', sourceType: 'ytdlp', provider: 'YouTube (yt-dlp)' });
  assert.equal(media.title, 'Vídeo do YouTube');
  assert.equal(media.thumbnail, 'https://i.ytimg.com/vi/abc/hqdefault.jpg');
  assert.equal(media.protocol, 'yt-dlp');
  assert.equal(media.provider, 'YouTube (yt-dlp)');
  assert.equal(media.formats.length, 2);
  assert.equal(media.formats[0].hasAudio, true); // progressive
  assert.equal(media.formats[1].hasAudio, false); // adaptive
  assert.equal(media.formats[0].estimatedSize, 150_000_000); // 4Mbps * 300s / 8
  assert.equal(media.estimatedSizeLabel, '143.1 MB');
  assert.equal(media.durationLabel, '5:00');
});

test('normalizeMediaInfo: fonte direta cria formato único', () => {
  const media = normalizeMediaInfo({ kind: 'direct', totalDuration: 0 }, { url: 'https://cdn/video.mp4', sourceType: 'direct', provider: 'midia direta' });
  assert.equal(media.sourceType, 'direct');
  assert.equal(media.protocol, 'HTTP direto');
  assert.equal(media.formats.length, 1);
  assert.equal(media.formats[0].resolution, 'Direto');
  assert.equal(media.formats[0].url, 'https://cdn/video.mp4');
  assert.equal(media.best.resolution, 'Direto');
});

test('normalizeMediaInfo: fonte desconhecida retorna shape estável', () => {
  const media = normalizeMediaInfo({ kind: 'unknown' }, { url: 'https://example.com/x', sourceType: 'unknown' });
  assert.equal(media.sourceType, 'unknown');
  assert.equal(media.protocol, 'desconhecido');
  assert.equal(media.formats.length, 1);
  assert.equal(media.title, 'Video');
  assert.equal(media.thumbnail, '');
});

test('normalizeMediaInfo: sourceType ytdlp sem variants gera formato direto', () => {
  const media = normalizeMediaInfo({ kind: 'ytdlp', title: 'X', variants: [] }, { url: 'https://youtu.be/abc', sourceType: 'ytdlp' });
  assert.equal(media.formats.length, 0);
  assert.equal(media.best, null);
  assert.equal(media.resolution, '');
});

test('emptyMediaInfo devolve shape estável', () => {
  const media = emptyMediaInfo({ url: 'https://example.com', sourceType: 'unknown' });
  assert.equal(media.kind, 'unknown');
  assert.equal(media.formats.length, 1);
  assert.ok(media.durationLabel);
});
