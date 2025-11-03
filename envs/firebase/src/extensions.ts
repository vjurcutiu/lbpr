import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { execa } from 'execa';

async function ensureFirebaseJson(dir: string) {
  const file = path.join(dir, 'firebase.json');
  try { await fs.access(file); } catch { await fs.writeFile(file, JSON.stringify({}, null, 2)); }
}

export async function exportExtensions(projectId: string, outDir: string) {
  await fs.mkdir(outDir, { recursive: true });
  await ensureFirebaseJson(outDir);
  const { stdout } = await execa('npx', ['-y', 'firebase-tools', 'ext:export', '--project', projectId, '--non-interactive'], { cwd: outDir });
  console.log(pc.green('✓ Extensions exported to manifest & .env files under:'), outDir);
  if (stdout) console.log(pc.dim(stdout.split('\n').slice(-8).join('\n')));
}

export async function applyExtensions(projectId: string, ssotDir: string) {
  const args = ['-y', 'firebase-tools', 'deploy', '--only', 'extensions', '--project', projectId, '--non-interactive'];
  const { stdout } = await execa('npx', args, { cwd: ssotDir });
  console.log(pc.green('✓ Extensions deployed from manifest in:'), ssotDir);
  if (stdout) console.log(pc.dim(stdout.split('\n').slice(-12).join('\n')));
}
