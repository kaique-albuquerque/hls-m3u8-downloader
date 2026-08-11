/**
 * P5 — Perfis de áudio (src/ffmpeg/audio.js)
 *
 * Formatos de áudio suportados (seção 11 do architect.md):
 * original/best, M4A, MP3, Opus, FLAC.
 *
 * Regras:
 *  - "só remux" (stream copy) quando o codec de origem já é compatível com o
 *    perfil — nunca recodificar sem necessidade;
 *  - "exige transcode" quando a origem é incompatível (ou desconhecida);
 *  - o consumidor pode sinalizar ao usuário quando uma opção exige conversão.
 */

export const AUDIO_PROFILES = {
  original: {
    id: 'original',
    label: 'Original (best)',
    ext: 'mp4',
    codec: null,
    description: 'Mantém o áudio original sem recodificar (copy).',
  },
  m4a: {
    id: 'm4a',
    label: 'M4A (AAC)',
    ext: 'm4a',
    codec: 'aac',
    description: 'Container M4A; copy quando a origem já é AAC.',
  },
  mp3: {
    id: 'mp3',
    label: 'MP3',
    ext: 'mp3',
    codec: 'libmp3lame',
    description: 'MP3 (exige transcode quando a origem não é MP3).',
  },
  opus: {
    id: 'opus',
    label: 'Opus',
    ext: 'opus',
    codec: 'libopus',
    description: 'Opus em container Ogg/opus (exige transcode quando a origem não é Opus).',
  },
  flac: {
    id: 'flac',
    label: 'FLAC',
    ext: 'flac',
    codec: 'flac',
    description: 'FLAC sem perdas (exige transcode quando a origem não é FLAC).',
  },
};

const CODEC_NAMES = {
  m4a: ['aac', 'mp4a'],
  mp3: ['mp3', 'mpga'],
  opus: ['opus'],
  flac: ['flac'],
};

/** Lista de perfis na ordem de exibição. */
export function getAudioProfiles() {
  return Object.values(AUDIO_PROFILES);
}

/**
 * Um perfil aceita "só remux" (copy) quando o codec de origem já é
 * compatível. 'original' é sempre copy. Codec de origem desconhecido →
 * false (não arriscar copy para um container incompatível).
 */
export function canRemuxToProfile(profileId, sourceCodec) {
  const profile = AUDIO_PROFILES[profileId];
  if (!profile) return false;
  if (profile.codec === null) return true;
  const codec = String(sourceCodec || '').toLowerCase();
  if (!codec) return false;
  const names = CODEC_NAMES[profileId];
  return names.some((n) => codec.includes(n));
}

/**
 * Converte um perfil em args do FFmpeg para extração de áudio (-vn).
 * Retorna { args, requiresTranscode, container, codec, label }:
 *  - requiresTranscode: true quando é preciso recodificar (informar o usuário);
 *  - container: extensão de saída (mp4/m4a/mp3/opus/flac).
 * Lança erro para perfil desconhecido.
 */
export function audioProfileToArgs(profileId, { sourceCodec } = {}) {
  const profile = AUDIO_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Perfil de audio desconhecido: ${profileId}`);
  }
  const requiresTranscode = !canRemuxToProfile(profileId, sourceCodec);
  const args = ['-vn'];
  args.push('-c:a', requiresTranscode ? profile.codec : 'copy');
  return {
    args,
    requiresTranscode,
    container: profile.ext,
    codec: requiresTranscode ? profile.codec : 'copy',
    label: profile.label,
  };
}
