import { killAllCurl } from '../curlimp.js';

/** Modos de extração do FFmpeg (fallbacks de compatibilidade). */
export const MODE_LABELS = [
  'copia direta (-c copy)',
  'copia direta com correcao de audio (aac_adtstoasc)',
  'reconversao do audio para AAC (-c:a aac)',
];

export function sourceLooksLikeYouTubeWatch(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  } catch {
    return false;
  }
}

export function createContext(io) {
  return {
    currentFfmpeg: null,
    interruptHandled: false,
    curlimpActive: false,
    io,
  };
}

export function onInterrupt(ctx) {
  if (ctx.interruptHandled) return;
  ctx.interruptHandled = true;

  if (ctx.currentFfmpeg) {
    ctx.io.log('\n\nInterrompendo o download... (aguarde)');
    ctx.currentFfmpeg.stop();
    return;
  }
  if (ctx.turboAbort) {
    ctx.io.log('\n\nCancelando o download paralelo (turbo)... (aguarde)');
    ctx.turboAbort.abort();
    return;
  }
  if (ctx.curlimpActive) {
    ctx.io.log('\n\nCancelando o download dos segmentos... (aguarde)');
    killAllCurl();
    return;
  }
  ctx.io.log('\nOperacao cancelada.');
}

export function createAnswerSource(answers = {}) {
  return async (question) => {
    if (typeof answers.ask === 'function') return answers.ask(question);
    return answers[question] ?? '';
  };
}
