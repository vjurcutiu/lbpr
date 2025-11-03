#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import pc from 'picocolors';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { exportAuthConfig, applyAuthConfig } from './auth.js';
import { exportRules, applyRules } from './rules.js';
import { exportExtensions, applyExtensions } from './extensions.js';
import { exportFunctionsConfig, applyFunctionsConfig } from './functions.js';

const SSOT_DIR = path.resolve(process.cwd(), 'ssot');

function guessProjectId() {
  return process.env.FIREBASE_PROJECT_ID || 'lexbot-pro';
}

const argv = (yargs(hideBin(process.argv)) as any)
  .command('export', 'Export remote settings to SSOT', (y: any) => y
    .option('project', { type: 'string', demandOption: false, default: guessProjectId() })
    .option('auth', { type: 'boolean', default: true })
    .option('rules', { type: 'boolean', default: true })
    .option('extensions', { type: 'boolean', default: true })
    .option('functions', { type: 'boolean', default: true })
  , async (args: any) => {
    const projectId = args.project!;
    await fs.mkdir(SSOT_DIR, { recursive: true });
    console.log(pc.cyan(pc.bold(`Exporting Firebase settings for ${projectId} → ${SSOT_DIR}`)));
    if (args.auth) await exportAuthConfig(projectId, SSOT_DIR);
    if (args.rules) await exportRules(projectId, SSOT_DIR);
    if (args.extensions) await exportExtensions(projectId, SSOT_DIR);
    if (args.functions) await exportFunctionsConfig(projectId, SSOT_DIR);
    console.log(pc.bold(pc.green('Done.')));
  })
  .command('apply', 'Apply SSOT to remote project', (y: any) => y
    .option('project', { type: 'string', demandOption: false, default: guessProjectId() })
    .option('auth', { type: 'boolean' })
    .option('rules', { type: 'boolean' })
    .option('extensions', { type: 'boolean' })
    .option('functions', { type: 'boolean' })
    .option('all', { type: 'boolean', default: false })
  , async (args: any) => {
    const projectId = args.project!;
    const pick = (flag?: boolean) => Boolean(args.all || flag);
    console.log(pc.cyan(pc.bold(`Applying SSOT → ${projectId} from ${SSOT_DIR}`)));
    if (pick(args.auth)) await applyAuthConfig(projectId, SSOT_DIR);
    if (pick(args.rules)) await applyRules(projectId, SSOT_DIR);
    if (pick(args.extensions)) await applyExtensions(projectId, SSOT_DIR);
    if (pick(args.functions)) await applyFunctionsConfig(projectId, SSOT_DIR);
    console.log(pc.bold(pc.green('Done.')));
  })
  .demandCommand(1)
  .help()
  .strict()
  .argv;
