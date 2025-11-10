import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { execa } from 'execa';
export async function exportFunctionsConfig(projectId, outDir) {
    await fs.mkdir(outDir, { recursive: true });
    try {
        const { stdout } = await execa('npx', ['-y', 'firebase-tools', 'functions:config:get', '--project', projectId], { cwd: outDir });
        const json = stdout?.trim() || '{}';
        const dest = path.join(outDir, 'functions.config.json');
        await fs.writeFile(dest, json + '\n');
        console.log(pc.green(`✓ functions:config exported → ${dest}`));
    }
    catch (e) {
        console.warn(pc.yellow('! Skipping functions:config export (maybe unused in Gen2).'), e?.shortMessage || '');
    }
}
function flatten(obj, prefix = '') {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            Object.assign(out, flatten(v, key));
        }
        else {
            out[key] = typeof v === 'string' ? v : JSON.stringify(v);
        }
    }
    return out;
}
export async function applyFunctionsConfig(projectId, ssotDir) {
    const file = path.join(ssotDir, 'functions.config.json');
    try {
        const raw = await fs.readFile(file, 'utf8');
        const json = JSON.parse(raw || '{}');
        const flat = flatten(json);
        if (!Object.keys(flat).length) {
            console.log(pc.dim('functions.config.json empty — nothing to set.'));
            return;
        }
        const pairs = Object.entries(flat).map(([k, v]) => `${k}=${v}`);
        const args = ['-y', 'firebase-tools', 'functions:config:set', '--project', projectId, ...pairs];
        await execa('npx', args, { cwd: ssotDir, stdio: 'inherit' });
        console.log(pc.green('✓ functions:config applied from'), file);
    }
    catch {
        console.warn(pc.yellow('! Skipping functions:config apply — file not found or invalid JSON:'), file);
    }
}
