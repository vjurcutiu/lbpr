#!/usr/bin/env node
// Small launcher that loads the compiled CLI
import('../dist/index.js').catch((e) => {
  console.error('Failed to start firebase-dump:', e?.message || e);
  process.exit(1);
});
