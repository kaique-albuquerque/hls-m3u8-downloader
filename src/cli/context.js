import { killAllCurl } from '../curlimp.js';

// P5: MODE_LABELS agora pertence ao muxer (src/ffmpeg/muxer.js) — re-export
// para manter a API publica deste modulo (consumido por cli-flow.js).
export { MODE_LABELS } from '../ffmpeg/muxer.js';

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
    currentHttpAbort: null,
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
  if (ctx.currentHttpAbort) {
    ctx.io.log('\n\nCancelando o download (transport http)... (aguarde)');
    ctx.currentHttpAbort.abort();
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
