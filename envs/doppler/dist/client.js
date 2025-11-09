import { HttpClient } from './http.js';
function toArray(v, mapItem) {
    if (Array.isArray(v))
        return mapItem ? v.map(mapItem) : v;
    if (!v || typeof v !== 'object')
        return [];
    // common array-valued keys
    for (const k of ['projects', 'environments', 'configs', 'names', 'secrets', 'data', 'items', 'results']) {
        const x = v[k];
        if (Array.isArray(x))
            return mapItem ? x.map(mapItem) : x;
    }
    return [];
}
export class DopplerClient {
    http;
    perPage;
    maxPages;
    constructor(opts) {
        this.http = new HttpClient(opts);
        this.perPage = opts.perPage ?? 200;
        this.maxPages = opts.maxPages ?? 10;
    }
    async me() {
        const r = await this.http.get('/me');
        return (r?.token ?? r);
    }
    async pagedGet(path, params = {}) {
        let page = 1;
        const acc = [];
        while (page <= this.maxPages) {
            const res = await this.http.get(path, { ...params, page, per_page: this.perPage });
            const arr = toArray(res);
            if (arr.length) {
                acc.push(...arr);
                if (arr.length < this.perPage)
                    break;
            }
            else {
                break;
            }
            page++;
        }
        return acc;
    }
    async listProjects() {
        const items = await this.pagedGet('/projects');
        return items;
    }
    async listEnvironments(project) {
        const items = await this.pagedGet('/environments', { project });
        return items;
    }
    async listConfigs(project, environment) {
        const items = await this.pagedGet('/configs', { project, environment });
        return items;
    }
    async getConfig(project, config) {
        const r = await this.http.get('/configs/config', { project, config });
        return (r?.config ?? r);
    }
    async listSecretNames(project, config) {
        const r = await this.http.get('/configs/config/secrets/names', { project, config });
        // Official docs show { names: string[] }
        // Normalize: strings → { name }, or objects having .name
        const arr = toArray(r);
        return arr.map((x) => (typeof x === 'string' ? { name: x } : { name: x?.name })).filter((n) => !!n.name);
    }
    async listSecrets(project, config, opts) {
        const r = await this.http.get('/configs/config/secrets', {
            project,
            config,
            include_dynamic_secrets: opts?.includeDynamic ? 'true' : 'false',
            include_managed_secrets: opts?.includeManaged ? 'true' : 'false'
        });
        // Docs & community libs show shape: { secrets: { NAME: { value, ... } } }
        const payload = (r && typeof r === 'object' && r.secrets) ? r.secrets : r;
        if (Array.isArray(payload)) {
            return payload;
        }
        else if (payload && typeof payload === 'object') {
            return Object.entries(payload).map(([name, obj]) => ({ name, ...(obj || {}) }));
        }
        return [];
    }
}
