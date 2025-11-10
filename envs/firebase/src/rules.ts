import { google } from 'googleapis';
import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { getGoogleAuth } from './googleAuth.js';

const SCOPE = 'https://www.googleapis.com/auth/firebase';

type RuleTarget = 'cloud.firestore' | 'firebase.storage';

/**
 * Firestore default DB release id can be either:
 *   projects/{project}/releases/cloud.firestore
 * or   projects/{project}/releases/cloud.firestore/(default)
 * They are equivalent per docs. We'll try the short one first, then the (default) form.
 */
function releaseCandidates(projectId: string, target: RuleTarget) {
  if (target === 'cloud.firestore') {
    return [
      `projects/${projectId}/releases/cloud.firestore`,
      `projects/${projectId}/releases/cloud.firestore/(default)`,
    ];
  }
  return [`projects/${projectId}/releases/firebase.storage`];
}

export async function exportRules(projectId: string, outDir: string) {
  const { client } = await getGoogleAuth([SCOPE]);
  const firebaserules = google.firebaserules({ version: 'v1', auth: client as any });

  await fs.mkdir(outDir, { recursive: true });

  for (const target of ['cloud.firestore','firebase.storage'] as RuleTarget[]) {
    let relName: string | null = null;
    let release: any | null = null;

    for (const cand of releaseCandidates(projectId, target)) {
      try {
        const r = await firebaserules.projects.releases.get({ name: cand });
        release = (r.data as any).release || r.data;
        relName = cand;
        break;
      } catch (e: any) {
        if (e?.code === 404 || e?.response?.status === 404) continue;
        throw e;
      }
    }

    const outfile = path.join(outDir, target === 'cloud.firestore' ? 'firestore.rules' : 'storage.rules');

    if (!release || !release.rulesetName) {
      const placeholder = target === 'cloud.firestore'
        ? `// rules_version = '2';
service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }
`
        : `// rules_version = '2';
service firebase.storage { match /b/{bucket}/o { match /{allPaths=**} { allow read, write: if false; } } }
`;
      try { await fs.access(outfile); }
      catch { await fs.writeFile(outfile, placeholder); }
      console.warn(pc.yellow(`! No ${target} release found — wrote/kept placeholder at ${outfile}`));
      continue;
    }

    const rs = await firebaserules.projects.rulesets.get({ name: release.rulesetName });
    const files = rs.data.source?.files || [];
    const content = files.map(f => f.content || '').join('\n');
    await fs.writeFile(outfile, content.trim() + '\n');
    console.log(pc.green(`✓ ${target} rules exported → ${outfile}`));
  }
}

function targetReleaseId(target: RuleTarget): string {
  return target === 'cloud.firestore' ? 'cloud.firestore' : 'firebase.storage';
}

export async function applyRules(projectId: string, ssotDir: string) {
  const { client } = await getGoogleAuth([SCOPE]);
  const firebaserules = google.firebaserules({ version: 'v1', auth: client as any });

  const tasks: Array<{target: RuleTarget, file: string}> = [
    { target: 'cloud.firestore', file: 'firestore.rules' },
    { target: 'firebase.storage', file: 'storage.rules' },
  ];

  for (const t of tasks) {
    const filePath = path.join(ssotDir, t.file);
    let content = '';
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      console.warn(pc.yellow(`! Skipping ${t.target} — file not found: ${filePath}`));
      continue;
    }

    const created = await firebaserules.projects.rulesets.create({
      name: `projects/${projectId}`,
      requestBody: { source: { files: [{ name: t.file, content }] } },
    });
    const rulesetName = created.data.name!;

    const relId = targetReleaseId(t.target);
    const relShort = `projects/${projectId}/releases/${relId}`;
    try {
      // IMPORTANT: updateMask must be inside requestBody per API
      await firebaserules.projects.releases.patch({
        name: relShort,
        requestBody: { release: { name: relShort, rulesetName }, updateMask: 'rulesetName' },
      });
    } catch (e: any) {
      const notFound = e?.code === 404 || e?.response?.status === 404;
      if (!notFound) throw e;
      await firebaserules.projects.releases.create({
        name: `projects/${projectId}`,
        requestBody: { name: relShort, rulesetName },
      });
    }

    console.log(pc.green(`✓ ${t.target} rules applied from ${filePath} → ${rulesetName}`));
  }
}
