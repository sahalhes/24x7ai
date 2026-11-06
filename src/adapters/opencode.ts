import { spawn } from 'node:child_process';
import { AgentAdapter, InvokeOptions, AgentResult, ProjectStatus, commandExists, getHeadCommit, getCommitsSince, getFilesChanged, readAgentStatusJson } from './base.js';

export class OpenCodeAdapter implements AgentAdapter {
  readonly name = 'opencode';
  readonly description = 'OpenCode CLI adapter';

  async detect(): Promise<boolean> {
    return commandExists('opencode');
  }

  async invoke(opts: InvokeOptions): Promise<AgentResult> {
    const cmd = opts.commandOverride || 'opencode';
    const beforeHead = await getHeadCommit(opts.projectDir);
    const startTime = Date.now();

    const args = [
      ...(opts.args || []),
      'run',
      '--standalone',
      '--auto',
      opts.prompt,
    ];

    return new Promise((resolve) => {
      let output = '';
      let timedOut = false;

      const proc = spawn(cmd, args, {
        cwd: opts.projectDir,
        env: { ...process.env, ...(opts.env || {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timeoutTimer: NodeJS.Timeout | undefined;
      if (opts.timeout && opts.timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGTERM');
        }, opts.timeout);
      }

      proc.stdout.on('data', (d) => {
        const text = d.toString();
        output += text;
        opts.onStdout?.(text);
      });

      proc.stderr.on('data', (d) => {
        const text = d.toString();
        output += text;
        opts.onStderr?.(text);
      });

      proc.on('close', async (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const duration = Date.now() - startTime;
        const commits = await getCommitsSince(opts.projectDir, beforeHead);
        const filesChanged = await getFilesChanged(opts.projectDir);

        resolve({
          exitCode: timedOut ? 124 : (code ?? 1),
          duration,
          commits,
          filesChanged,
          rawOutput: output,
          error: timedOut ? 'Execution timed out' : (code !== 0 ? `Process exited with code ${code}` : undefined),
        });
      });

      proc.on('error', (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve({
          exitCode: 1,
          duration: Date.now() - startTime,
          commits: [],
          filesChanged: [],
          error: `Failed to spawn ${cmd}: ${err.message}`,
        });
      });
    });
  }

  async parseStatus(projectDir: string): Promise<ProjectStatus | null> {
    return readAgentStatusJson(projectDir);
  }
}
