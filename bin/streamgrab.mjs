#!/usr/bin/env node
/**
 * P9 — Entry point da CLI evoluída (`streamgrab`).
 *
 * Delega ao main() do src/index.js (mesmo dispatch de `node src/index.js`).
 * Quando instalado via npm (package.json "bin"), o `streamgrab` fica
 * disponível no PATH.
 */
import { main } from '../src/index.js';

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error('\n[ERRO inesperado]', err && err.stack ? err.stack : err);
    process.exit(1);
  });
