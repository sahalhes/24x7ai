import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface InvokeOptions {
  projectDir: string;
  prompt: string;
  timeout?: number; // ms
  env?: Record<string, string>;
  args?: string[];
  commandOverride?: string;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface AgentResult {
  exitCode: number;
  duration: number; // ms
  commits: string[]; // SHAs produced
  filesChanged: string[];
  rawOutput?: string;
  error?: string;
}

export interface ProjectStatus {
  sl_no?: number;
  project?: string;
  status?: string;
  mvp_complete?: boolean;
  development_complete?: boolean;
  branch?: string;
  last_run?: string;
  next_action?: string;
  blocked?: boolean;
}

export interface AgentAdapter {
  readonly name: string;
  readonly description: string;
  detect(): Promise<boolean>;
  invoke(opts: InvokeOptions): Promise<AgentResult>;
  parseStatus(projectDir: string): Promise<ProjectStatus | null>;
}

export async function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', [command], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export async function getHeadCommit(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', 'HEAD'], { cwd });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      resolve(code === 0 ? stdout.trim() : null);
    });
    proc.on('error', () => resolve(null));
  });
}

export async function getCommitsSince(cwd: string, beforeSha: string | null): Promise<string[]> {
  return new Promise((resolve) => {
    const range = beforeSha ? `${beforeSha}..HEAD` : 'HEAD';
    const proc = spawn('git', ['rev-list', range], { cwd });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return resolve([]);
      const lines = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      resolve(lines);
    });
    proc.on('error', () => resolve([]));
  });
}

export async function getFilesChanged(cwd: string): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['status', '--porcelain'], { cwd });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return resolve([]);
      const lines = stdout.split('\n')
        .map((l) => l.slice(3).trim())
        .filter(Boolean);
      resolve(lines);
    });
    proc.on('error', () => resolve([]));
  });
}

export function readAgentStatusJson(projectDir: string): ProjectStatus | null {
  const filePath = path.join(projectDir, '.agent-status.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
