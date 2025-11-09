import { HttpOptions } from './http.js';
import type { Project, Environment, Config, SecretName, SecretValue, TokenInfo } from './types.js';
export interface DopplerClientOptions extends Omit<HttpOptions, 'token'> {
    token: string;
    perPage?: number;
    maxPages?: number;
}
export declare class DopplerClient {
    private http;
    private perPage;
    private maxPages;
    constructor(opts: DopplerClientOptions);
    me(): Promise<TokenInfo>;
    private pagedGet;
    listProjects(): Promise<Project[]>;
    listEnvironments(project: string): Promise<Environment[]>;
    listConfigs(project: string, environment?: string): Promise<Config[]>;
    getConfig(project: string, config: string): Promise<Config>;
    listSecretNames(project: string, config: string): Promise<SecretName[]>;
    listSecrets(project: string, config: string, opts?: {
        includeDynamic?: boolean;
        includeManaged?: boolean;
    }): Promise<SecretValue[]>;
}
