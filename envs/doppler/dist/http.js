import { fetch, Headers } from 'undici';
export class HttpError extends Error {
    status;
    statusText;
    body;
    constructor(status, statusText, body) {
        super(`HTTP ${status} ${statusText}${body ? `: ${JSON.stringify(body).slice(0, 500)}` : ''}`);
        this.status = status;
        this.statusText = statusText;
        this.body = body;
    }
}
export class HttpClient {
    opts;
    baseUrl;
    maxRetries;
    timeoutMs;
    verbose;
    constructor(opts) {
        this.opts = opts;
        this.baseUrl = opts.baseUrl ?? 'https://api.doppler.com/v3';
        this.maxRetries = opts.maxRetries ?? 3;
        this.timeoutMs = opts.timeoutMs ?? 30_000;
        this.verbose = !!opts.verbose;
    }
    log(...args) { if (this.verbose)
        console.log('[doppler-sdk]', ...args); }
    qs(params) {
        if (!params)
            return '';
        const usp = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null)
                continue;
            usp.set(k, String(v));
        }
        const s = usp.toString();
        return s ? `?${s}` : '';
    }
    async get(path, params) { return this.request('GET', path, undefined, params); }
    async request(method, path, body, params) {
        const url = `${this.baseUrl}${path}${this.qs(params)}`;
        const headers = new Headers({
            'authorization': `Bearer ${this.opts.token}`,
            'accept': 'application/json',
            'content-type': 'application/json'
        });
        let attempt = 0, lastErr, waitMs = 500;
        while (attempt <= this.maxRetries) {
            attempt++;
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                this.log(`${method} ${url}`);
                const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
                clearTimeout(id);
                if (res.status === 204)
                    return null;
                if (res.status === 429) {
                    const retryAfter = Number(res.headers.get('retry-after'));
                    const ms = isNaN(retryAfter) ? waitMs : retryAfter * 1000;
                    this.log(`429 rate limited, retrying in ${ms}ms`);
                    await new Promise(r => setTimeout(r, ms));
                    waitMs = Math.min(waitMs * 2, 8000);
                    continue;
                }
                if (!res.ok) {
                    let errBody = undefined;
                    try {
                        errBody = await res.json();
                    }
                    catch { }
                    throw new HttpError(res.status, res.statusText, errBody);
                }
                const text = await res.text();
                try {
                    return text ? JSON.parse(text) : null;
                }
                catch {
                    return text;
                }
            }
            catch (err) {
                lastErr = err;
                if (attempt > this.maxRetries)
                    break;
                const status = err?.status;
                if (status && status >= 400 && status < 500 && status !== 429)
                    break;
                this.log(`Attempt ${attempt}/${this.maxRetries} failed: ${err?.message || err}`);
                await new Promise(r => setTimeout(r, waitMs));
                waitMs = Math.min(waitMs * 2, 8000);
            }
        }
        throw lastErr ?? new Error('Unknown HTTP error');
    }
}
