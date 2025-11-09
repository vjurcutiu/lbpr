
import { HttpClient, HttpOptions } from './http.js';
import type { Project, Environment, Config, SecretName, SecretValue, TokenInfo } from './types.js';

export interface DopplerClientOptions extends Omit<HttpOptions, 'token'> {
  token: string;
  perPage?: number;
  maxPages?: number;
}

function toArray<T>(v: any, mapItem?: (x: any) => T): T[] {
  if (Array.isArray(v)) return mapItem ? v.map(mapItem) : v;
  if (!v || typeof v !== 'object') return [];
  // common array-valued keys
  for (const k of ['projects','environments','configs','names','secrets','data','items','results']) {
    const x = (v as any)[k];
    if (Array.isArray(x)) return mapItem ? x.map(mapItem) : x;
  }
  return [];
}

export class DopplerClient {
  private http: HttpClient;
  private perPage: number;
  private maxPages: number;

  constructor(opts: DopplerClientOptions) {
    this.http = new HttpClient(opts);
    this.perPage = opts.perPage ?? 200;
    this.maxPages = opts.maxPages ?? 10;
  }

  async me(): Promise<TokenInfo> {
    const r = await this.http.get('/me');
    return (r?.token ?? r) as TokenInfo;
  }

  private async pagedGet(path: string, params: Record<string, any> = {}): Promise<any[]> {
    let page = 1;
    const acc: any[] = [];
    while (page <= this.maxPages) {
      const res = await this.http.get(path, { ...params, page, per_page: this.perPage });
      const arr = toArray<any>(res);
      if (arr.length) {
        acc.push(...arr);
        if (arr.length < this.perPage) break;
      } else {
        break;
      }
      page++;
    }
    return acc;
  }

  async listProjects(): Promise<Project[]> {
    const items = await this.pagedGet('/projects');
    return items as Project[];
  }

  async listEnvironments(project: string): Promise<Environment[]> {
    const items = await this.pagedGet('/environments', { project });
    return items as Environment[];
  }

  async listConfigs(project: string, environment?: string): Promise<Config[]> {
    const items = await this.pagedGet('/configs', { project, environment });
    return items as Config[];
  }

  async getConfig(project: string, config: string): Promise<Config> {
    const r = await this.http.get('/configs/config', { project, config });
    return (r?.config ?? r) as Config;
  }

  async listSecretNames(project: string, config: string): Promise<SecretName[]> {
    const r = await this.http.get('/configs/config/secrets/names', { project, config });
    // Official docs show { names: string[] }
    // Normalize: strings → { name }, or objects having .name
    const arr = toArray<string | SecretName>(r);
    return arr.map((x: any) => (typeof x === 'string' ? { name: x } : { name: x?.name })).filter((n: any) => !!n.name);
  }

  async listSecrets(project: string, config: string, opts?: { includeDynamic?: boolean; includeManaged?: boolean; }): Promise<SecretValue[]> {
    const r = await this.http.get('/configs/config/secrets', { 
      project, 
      config,
      include_dynamic_secrets: opts?.includeDynamic ? 'true' : 'false',
      include_managed_secrets: opts?.includeManaged ? 'true' : 'false'
    });
    // Docs & community libs show shape: { secrets: { NAME: { value, ... } } }
    const payload = (r && typeof r === 'object' && (r as any).secrets) ? (r as any).secrets : r;
    if (Array.isArray(payload)) {
      return payload as SecretValue[];
    } else if (payload && typeof payload === 'object') {
      return Object.entries(payload).map(([name, obj]: [string, any]) => ({ name, ...(obj || {}) }));
    }
    return [];
  }
}
