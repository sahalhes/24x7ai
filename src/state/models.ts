export type DaemonStatus = 'idle' | 'scheduled' | 'running' | 'error' | 'stuck' | 'paused';
export type RunType = 'mvp' | 'daemon' | 'manual';

export interface ProjectRecord {
  id: number;
  slug: string;
  idea: string;
  sl_no: number;
  source_csv?: string;
  mvp_complete: boolean;
  daemon_active: boolean;
  daemon_schedule: string;
  created_at: string;
  updated_at: string;
}

export interface AgentRunRecord {
  id: number;
  project_id: number;
  adapter: string;
  prompt?: string;
  exit_code?: number;
  duration_ms?: number;
  commits_produced: number;
  files_changed: number;
  error?: string;
  run_type: RunType;
  started_at: string;
  finished_at?: string;
}

export interface DaemonStateRecord {
  project_id: number;
  status: DaemonStatus;
  last_run_id?: number;
  next_run_at?: string;
  consecutive_errors: number;
  consecutive_no_changes: number;
  backoff_until?: string;
  updated_at: string;
}

export interface ProjectWithDaemon extends ProjectRecord {
  daemon_status?: DaemonStatus;
  next_run_at?: string;
  consecutive_errors?: number;
  last_run_started_at?: string;
  last_run_duration_ms?: number;
  last_run_commits?: number;
  open_issues_count?: number;
}
