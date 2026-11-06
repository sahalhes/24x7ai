import { spawn } from 'node:child_process';

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
}

export async function fetchProjectIssues(
  projectDir: string,
  filterLabel?: string
): Promise<GitHubIssue[]> {
  return new Promise((resolve) => {
    const args = ['issue', 'list', '--json', 'number,title,body,labels', '--state', 'open'];
    if (filterLabel) {
      args.push('--label', filterLabel);
    }

    const proc = spawn('gh', args, { cwd: projectDir });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return resolve([]);
      try {
        const issues = JSON.parse(stdout) as GitHubIssue[];
        resolve(issues);
      } catch {
        resolve([]);
      }
    });
    proc.on('error', () => resolve([]));
  });
}
