export interface GatewayConfig {
  enabled: boolean;
  endpoint: string; // default http://localhost:8000/v1 or Otari proxy URL
  apiKey?: string;
  budgetCapUsd?: number;
  virtualKey?: string;
  model?: string;
}

export interface GitHubConfig {
  owner?: string;
  privateRepos?: boolean;
  autoPush?: boolean;
  autoPr?: boolean;
  issueFilterLabel?: string;
  draftPr?: boolean;
}

export interface AppConfig {
  projectsRoot: string;
  ideaSourceType: 'csv-url' | 'local-csv' | 'google-sheets';
  ideaSource: string;
  defaultAdapter: string;
  adapterCommand?: string;
  adapterArgs?: string[];
  maxParallel: number;
  daemonSchedule: string;
  stuckTimeoutMs: number;
  stuckConsecutiveNoChanges: number;
  maxConsecutiveErrors: number;
  github: GitHubConfig;
  gitUserName?: string;
  gitUserEmail?: string;
  otari: GatewayConfig;
  commitMessageTemplate?: string;
  customEnv?: Record<string, string>;
  webhookUrl?: string;
  promptPrefix?: string;
  promptSuffix?: string;
  dryRun?: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  projectsRoot: process.env.PROJECTS_ROOT || `${process.env.HOME || '/root'}/projects`,
  ideaSourceType: 'local-csv',
  ideaSource: 'ideas.example.csv',
  defaultAdapter: 'opencode',
  maxParallel: 4,
  daemonSchedule: '*/30 * * * *',
  stuckTimeoutMs: 30 * 60 * 1000, // 30 minutes
  stuckConsecutiveNoChanges: 3,
  maxConsecutiveErrors: 5,
  github: {
    privateRepos: true,
    autoPush: true,
    autoPr: false,
    issueFilterLabel: 'agent-task',
  },
  otari: {
    enabled: false,
    endpoint: 'http://localhost:8000/v1',
  },
};
