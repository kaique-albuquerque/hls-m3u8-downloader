import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * Cria a interface de prompts. Usa uma fila de linhas própria (em vez de
 * rl.question) para funcionar tanto no modo interativo quanto com entrada
 * via pipe/script. O Ctrl+C é capturado pelo listener registrado no index.js,
 * evitando processos órfãos.
 */
export function createPrompter() {
  const rl = readline.createInterface({ input, output });
  const queue = [];
  const waiters = [];
  let closed = false;

  rl.on('line', (line) => {
    const w = waiters.shift();
    if (w) w(line);
    else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
  });

  return {
    rl,
    /** Faz uma pergunta e aguarda uma linha de resposta. */
    async ask(question) {
      process.stdout.write(question);
      if (queue.length) return queue.shift();
      if (closed) {
        console.log('\nOperação cancelada.');
        process.exit(130);
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
    close() {
      rl.close();
    },
  };
}

export const ask = (prompter, question) => prompter.ask(question);
