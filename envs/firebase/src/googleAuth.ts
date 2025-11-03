import { GoogleAuth } from 'google-auth-library';

export async function getGoogleAuth(scopes: string[]) {
  const auth = new GoogleAuth({ scopes });
  const client = await auth.getClient();
  const projectId = await auth.getProjectId();
  return { auth, client, projectId };
}
