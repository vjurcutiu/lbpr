
export interface Project { id: string; name: string; description?: string; created_at?: string; }
export interface Environment { id: string; name: string; project: string; created_at?: string; initial_fetch_at?: string; }
export interface Config { name: string; project: string; environment: string; created_at?: string; initial_fetch_at?: string; last_fetch_at?: string; root: boolean; locked?: boolean; }
export interface SecretName { name: string; }
export interface SecretValue { name: string; value?: string; computed?: boolean; raw?: string; note?: string | null; type?: string; }
export interface TokenInfo { token_type: string; subject?: string; email?: string; scopes?: string[]; }
export interface ExportedConfigSummary { project: string; environment: string; config: string; is_root: boolean; secret_names?: string[]; secrets?: SecretValue[]; }
export interface ExportSnapshot {
  generated_at: string;
  base_url: string;
  token_info?: TokenInfo;
  projects: Array<{ id: string; name: string; environments: Environment[]; configs: Config[]; summaries: ExportedConfigSummary[]; }>;
}
