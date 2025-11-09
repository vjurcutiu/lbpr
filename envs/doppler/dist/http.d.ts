export type QueryParams = Record<string, string | number | boolean | undefined | null>;
export declare class HttpError extends Error {
    status: number;
    statusText: string;
    body?: any | undefined;
    constructor(status: number, statusText: string, body?: any | undefined);
}
export interface HttpOptions {
    token: string;
    baseUrl?: string;
    maxRetries?: number;
    timeoutMs?: number;
    verbose?: boolean;
}
export declare class HttpClient {
    private opts;
    private baseUrl;
    private maxRetries;
    private timeoutMs;
    private verbose;
    constructor(opts: HttpOptions);
    private log;
    private qs;
    get(path: string, params?: QueryParams): Promise<any>;
    request(method: string, path: string, body?: any, params?: QueryParams): Promise<any>;
}
