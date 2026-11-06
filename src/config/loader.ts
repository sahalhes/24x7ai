import fs from 'node:fs';
import path from 'node:path';
import { AppConfig, DEFAULT_CONFIG } from './schema.js';

export const CONFIG_FILE_NAME = '.24x7ai.config.json';
export const LEGACY_ENV_FILE_NAME = '.agent-orchestrator.env';

export function resolveProjectsRoot(explicitPath?: string): string {
  if (explicitPath) return path.resolve(explicitPath);
  if (process.env.PROJECTS_ROOT) return path.resolve(process.env.PROJECTS_ROOT);
  return path.resolve(DEFAULT_CONFIG.projectsRoot);
}

export function getConfigFilePath(projectsRoot: string): string {
  return path.join(projectsRoot, CONFIG_FILE_NAME);
}

export function parseLegacyEnv(envContent: string): Partial<AppConfig> {
  const result: Record<string, string> = {};
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) {
      result[match[1]] = match[2].replace(/^'|'$/g, '').replaceAll("'\\''", "'");
    }
  }

  const partial: Partial<AppConfig> = {};
  if (result.PROJECTS_ROOT) partial.projectsRoot = result.PROJECTS_ROOT;
  if (result.IDEA_SOURCE_TYPE) {
    const t = result.IDEA_SOURCE_TYPE;
    if (t === 'csv-url' || t === 'local-csv' || t === 'google-sheets') {
      partial.ideaSourceType = t;
    }
  }
  if (result.IDEA_SOURCE) partial.ideaSource = result.IDEA_SOURCE;
  if (result.AGENT_PROVIDER) {
    partial.defaultAdapter = result.AGENT_PROVIDER === 'claude' ? 'claude-code' : result.AGENT_PROVIDER;
  }
  if (result.AGENT_COMMAND) partial.adapterCommand = result.AGENT_COMMAND;
  if (result.AGENT_ARGS) partial.adapterArgs = result.AGENT_ARGS.split(/\s+/).filter(Boolean);
  if (result.GITHUB_OWNER) {
    partial.github = {
      owner: result.GITHUB_OWNER,
      privateRepos: result.GITHUB_PRIVATE !== 'false',
    };
  }

  return partial;
}

export function loadConfig(projectsRoot?: string): AppConfig {
  const root = resolveProjectsRoot(projectsRoot);
  const jsonPath = getConfigFilePath(root);
  const legacyPath = path.join(root, LEGACY_ENV_FILE_NAME);

  let loaded: Partial<AppConfig> = {};

  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, 'utf8');
      loaded = JSON.parse(content);
    } catch (err: any) {
      throw new Error(`Failed to parse ${jsonPath}: ${err.message}`);
    }
  } else if (fs.existsSync(legacyPath)) {
    const content = fs.readFileSync(legacyPath, 'utf8');
    loaded = parseLegacyEnv(content);
  }

  const merged: AppConfig = {
    ...DEFAULT_CONFIG,
    ...loaded,
    projectsRoot: root,
    github: {
      ...DEFAULT_CONFIG.github,
      ...(loaded.github || {}),
    },
    otari: {
      ...DEFAULT_CONFIG.otari,
      ...(loaded.otari || {}),
    },
  };

  // Allow environment variable overrides
  if (process.env.AGENT_COMMAND) merged.adapterCommand = process.env.AGENT_COMMAND;
  if (process.env.AGENT_PROVIDER) {
    const prov = process.env.AGENT_PROVIDER.toLowerCase();
    if (prov === 'claude') {
      merged.defaultAdapter = 'claude-code';
    } else if (prov === 'agy') {
      merged.defaultAdapter = 'antigravity';
    } else {
      merged.defaultAdapter = process.env.AGENT_PROVIDER;
    }
  }
  if (process.env.GITHUB_OWNER) merged.github.owner = process.env.GITHUB_OWNER;
  if (process.env.OTARI_API_KEY) merged.otari.apiKey = process.env.OTARI_API_KEY;
  if (process.env.OTARI_ENDPOINT) merged.otari.endpoint = process.env.OTARI_ENDPOINT;

  return merged;
}

export function saveConfig(projectsRoot: string, config: Partial<AppConfig>): AppConfig {
  const root = resolveProjectsRoot(projectsRoot);
  const existing = fs.existsSync(getConfigFilePath(root)) ? loadConfig(root) : DEFAULT_CONFIG;

  const updated: AppConfig = {
    ...existing,
    ...config,
    projectsRoot: root,
    github: {
      ...existing.github,
      ...(config.github || {}),
    },
    otari: {
      ...existing.otari,
      ...(config.otari || {}),
    },
  };

  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(getConfigFilePath(root), JSON.stringify(updated, null, 2) + '\n', {
    mode: 0o600,
  });

  return updated;
}
