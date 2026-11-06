import { spawn } from 'node:child_process';
import fs from 'node:fs';

export async function createWorktree(repoDir: string, worktreeDir: string, branch = 'dev'): Promise<boolean> {
  return new Promise((resolve) => {
    fs.mkdirSync(worktreeDir, { recursive: true });
    const proc = spawn('git', ['worktree', 'add', '-B', branch, worktreeDir, branch], {
      cwd: repoDir,
      stdio: 'ignore',
    });
    proc.on('close', (code) => {
      if (code === 0) return resolve(true);
      // Fallback: create from HEAD if branch doesn't exist
      const fallback = spawn('git', ['worktree', 'add', '-b', branch, worktreeDir, 'HEAD'], {
        cwd: repoDir,
        stdio: 'ignore',
      });
      fallback.on('close', (c) => resolve(c === 0));
      fallback.on('error', () => resolve(false));
    });
    proc.on('error', () => resolve(false));
  });
}

export async function removeWorktree(repoDir: string, worktreeDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['worktree', 'remove', '--force', worktreeDir], {
      cwd: repoDir,
      stdio: 'ignore',
    });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export async function pruneWorktrees(repoDir: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['worktree', 'prune'], { cwd: repoDir, stdio: 'ignore' });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}
