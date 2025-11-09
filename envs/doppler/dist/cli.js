#!/usr/bin/env node
import "dotenv/config";
import { Command } from 'commander';
import { DopplerClient } from './client.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
const program = new Command();
program
    .name('doppler-dump')
    .description('Export projects → environments → configs (+ optional secret names/values) from Doppler as JSON.')
    .option('--token <string>', 'Doppler token (falls back to env DOPPLER_TOKEN or DOPPLER_API_TOKEN)')
    .option('--base-url <string>', 'API base URL', 'https://api.doppler.com/v3')
    .option('--project <string>', 'Only scan this project id/slug')
    .option('--include-values', 'Include secret values (default false)', false)
    .option('--include-dynamic', 'Include dynamic secret values (issue leases)', false)
    .option('--include-managed', 'Include managed secrets', false)
    .option('--stdout', 'Print to stdout instead of writing to a file', false)
    .option('--out <path>', 'Output file path (default: doppler_export_<timestamp>.json)')
    .option('--concurrency <n>', 'Concurrent secret fetches per project', (v) => parseInt(v, 10), 5)
    .option('--per-page <n>', 'Page size for list endpoints', (v) => parseInt(v, 10), 200)
    .option('--max-pages <n>', 'Max pages to fetch', (v) => parseInt(v, 10), 10)
    .option('--verbose', 'Verbose http logging', false)
    .parse(process.argv);
const opts = program.opts();
const token = opts.token || process.env.DOPPLER_TOKEN || process.env.DOPPLER_API_TOKEN;
if (!token) {
    console.error('Error: Provide a token via --token or env DOPPLER_TOKEN / DOPPLER_API_TOKEN');
    process.exit(1);
}
const client = new DopplerClient({
    token,
    baseUrl: opts.baseUrl,
    perPage: opts.perPage,
    maxPages: opts.maxPages,
    verbose: opts.verbose
});
function isStringArray(a) { return Array.isArray(a) && a.every(x => typeof x === 'string'); }
async function withConcurrency(items, limit, task) {
    const results = [];
    let index = 0;
    const workers = new Array(Math.min(limit, Math.max(1, items.length))).fill(0).map(async () => {
        while (index < items.length) {
            const i = index++;
            results[i] = await task(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}
(async () => {
    const [tokenInfo, projects] = await Promise.all([client.me().catch(() => undefined), client.listProjects()]);
    const filteredProjects = opts.project ? projects.filter(p => p.id === opts.project || p.name === opts.project) : projects;
    const out = {
        generated_at: new Date().toISOString(),
        base_url: opts.baseUrl,
        token_info: tokenInfo,
        projects: []
    };
    for (const project of filteredProjects) {
        const [envs, configs] = await Promise.all([
            client.listEnvironments(project.id),
            client.listConfigs(project.id)
        ]);
        const task = async (cfg) => {
            const base = { project: project.id, environment: cfg.environment, config: cfg.name, is_root: !!cfg.root };
            if (!opts.includeValues) {
                const names = await client.listSecretNames(project.id, cfg.name);
                const arr = Array.isArray(names) ? names.map((n) => (typeof n === 'string' ? n : n?.name)).filter(Boolean) : [];
                return { ...base, secret_names: arr };
            }
            else {
                const secrets = await client.listSecrets(project.id, cfg.name, {
                    includeDynamic: !!opts.includeDynamic,
                    includeManaged: !!opts.includeManaged
                });
                return { ...base, secrets };
            }
        };
        const summariesRes = await withConcurrency(configs, opts.concurrency, task);
        out.projects.push({ id: project.id, name: project.name, environments: envs, configs, summaries: summariesRes });
    }
    const json = JSON.stringify(out, null, 2);
    if (opts.stdout) {
        console.log(json);
    }
    else {
        const file = opts.out || path.join(process.cwd(), `doppler_export_${Date.now()}.json`);
        fs.writeFileSync(file, json, 'utf8');
        console.log(`Wrote ${file}`);
    }
})().catch(err => {
    console.error('Failed:', err?.message || err);
    process.exit(1);
});
