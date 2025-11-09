#!/usr/bin/env node
import('../dist/cli.js').catch((e) => {
  console.error('Failed to start doppler-dump CLI:', e?.message || e);
  process.exit(1);
});
