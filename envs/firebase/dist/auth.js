import { google } from 'googleapis';
import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { getGoogleAuth } from './googleAuth.js';
const SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';
export async function exportAuthConfig(projectId, outDir) {
    const { client } = await getGoogleAuth([SCOPE]);
    const identity = google.identitytoolkit({ version: 'v2', auth: client });
    const name = `projects/${projectId}/config`;
    const res = await identity.projects.getConfig({ name });
    await fs.mkdir(outDir, { recursive: true });
    const file = path.join(outDir, 'auth.config.json');
    await fs.writeFile(file, JSON.stringify(res.data, null, 2));
    console.log(pc.green(`✓ Auth config exported → ${file}`));
}
export async function applyAuthConfig(projectId, ssotDir) {
    const file = path.join(ssotDir, 'auth.config.json');
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    const { client } = await getGoogleAuth([SCOPE]);
    const identity = google.identitytoolkit({ version: 'v2', auth: client });
    const name = `projects/${projectId}/config`;
    await identity.projects.updateConfig({ name, updateMask: undefined, requestBody: data });
    console.log(pc.green(`✓ Auth config applied from ${file}`));
}
