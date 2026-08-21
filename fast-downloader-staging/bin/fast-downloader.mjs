#!/usr/bin/env node
import { main } from '../src/index.js';

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error('\n[fast-downloader] erro inesperado');
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
  });
