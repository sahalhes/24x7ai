import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { GitHubConfig } from '../config/schema.js';
import { Logger } from '../utils/logger.js';

function execGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }));
  });
}

function execGh(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('gh', args, { cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }));
  });
}

export async function ensureGitRepo(projectDir: string, defaultBranch = 'main', author?: { name?: string; email?: string }): Promise<void> {
  const name = author?.name || process.env.GIT_USER_NAME || 'Autonomous Agent';
  const email = author?.email || process.env.GIT_USER_EMAIL || 'agent@localhost';
  const gitDir = path.join(projectDir, '.git');
  if (!fs.existsSync(gitDir)) {
    await execGit(['init', '-b', defaultBranch], projectDir);
    await execGit(['config', 'user.name', name], projectDir);
    await execGit(['config', 'user.email', email], projectDir);
  }
}

export async function ensureDevBranch(projectDir: string): Promise<void> {
  const check = await execGit(['show-ref', '--verify', '--quiet', 'refs/heads/dev'], projectDir);
  if (check.code === 0) {
    await execGit(['checkout', 'dev'], projectDir);
  } else {
    await execGit(['checkout', '-b', 'dev'], projectDir);
  }
}

export async function commitWorkingTree(projectDir: string, message: string): Promise<string | null> {
  const status = await execGit(['status', '--porcelain'], projectDir);
  if (!status.stdout.trim()) {
    return null; // Nothing to commit
  }
  await execGit(['add', '-A'], projectDir);
  const commit = await execGit(['commit', '-m', message], projectDir);
  if (commit.code !== 0) return null;

  const rev = await execGit(['rev-parse', 'HEAD'], projectDir);
  return rev.code === 0 ? rev.stdout.trim() : null;
}

export async function syncGitHubRepo(
  projectDir: string,
  slug: string,
  config: GitHubConfig,
  logger?: Logger
): Promise<boolean> {
  if (!config.owner) return false;

  const repoName = `${config.owner}/${slug}`;

  // Check if remote already exists
  const remoteCheck = await execGit(['remote', 'get-url', 'origin'], projectDir);
  if (remoteCheck.code !== 0) {
    // Check if repo exists on GitHub
    const view = await execGh(['repo', 'view', repoName], projectDir);
    if (view.code === 0) {
      await execGit(['remote', 'add', 'origin', `git@github.com:${repoName}.git`], projectDir);
    } else {
      logger?.info(`Creating GitHub repository ${repoName}...`);
      const createArgs = ['repo', 'create', repoName, '--source=.', '--remote=origin'];
      if (config.privateRepos !== false) {
        createArgs.push('--private');
      } else {
        createArgs.push('--public');
      }
      const createRes = await execGh(createArgs, projectDir);
      if (createRes.code !== 0) {
        logger?.warn(`Could not create GitHub repo ${repoName}: ${createRes.stderr}`);
        return false;
      }
    }
  }

  // Push main and dev
  if (config.autoPush !== false) {
    logger?.info(`Pushing to ${repoName}...`);
    // Check if remote main exists
    const lsMain = await execGit(['ls-remote', '--exit-code', '--heads', 'origin', 'main'], projectDir);
    if (lsMain.code !== 0) {
      await execGit(['branch', '-f', 'main', 'HEAD'], projectDir);
      await execGit(['push', '-u', 'origin', 'main'], projectDir);
      await execGit(['checkout', 'dev'], projectDir);
    }
    await execGit(['push', '-u', 'origin', 'dev'], projectDir);
  }

  return true;
}
