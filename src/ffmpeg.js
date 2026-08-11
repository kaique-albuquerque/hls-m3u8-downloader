/**
 * P5 — Re-export fino (strangler).
 *
 * A implementação real do FFmpeg mora em src/ffmpeg/:
 *  - service.js — FfmpegService (binário, execução, progresso, cancelamento);
 *  - muxer.js — remux/mux com modos de compatibilidade;
 *  - audio.js — perfis de áudio (original/M4A/MP3/Opus/FLAC).
 *
 * Este módulo preserva a API pública legada (getFfmpegCommand, checkFfmpeg,
 * startDownload, startMuxDownload) até todos os consumidores migrarem.
 */

export { FfmpegService, ffmpegService, getFfmpegCommand, checkFfmpeg } from './ffmpeg/service.js';
export { MODES, MODE_LABELS, formatHeaders, buildDownloadArgs, buildMuxArgs, startDownload, startMuxDownload, remux, mux } from './ffmpeg/muxer.js';
export { AUDIO_PROFILES, getAudioProfiles, canRemuxToProfile, audioProfileToArgs } from './ffmpeg/audio.js';
