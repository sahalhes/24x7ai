import { spawn } from 'node:child_process';

export async function createPullRequest(
  projectDir: string,
  opts: {
    title: string;
    body: string;
    base?: string;
    head?: string;
  }
): Promise<{ success: boolean; url?: string; error?: string }> {
  return new Promise((resolve) => {
    const args = [
      'pr', 'create',
      '--title', opts.title,
      '--body', opts.body,
      '--base', opts.base || 'main',
      '--head', opts.head || 'dev',
    ];

    const proc = spawn('gh', args, { cwd: projectDir });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, url: stdout.trim() });
      } else {
        resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}
