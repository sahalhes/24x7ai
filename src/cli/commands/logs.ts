import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pc from 'picocolors';
import { resolveProjectsRoot } from '../../config/loader.js';

export function runLogs(
  identifier?: string,
  options?: { follow?: boolean; projectsDir?: string }
): void {
  const root = resolveProjectsRoot(options?.projectsDir);
  let logFile: string;

  if (!identifier || identifier === 'pipeline' || identifier === 'master') {
    logFile = path.join(root, '.24x7ai', 'logs', 'pipeline.log');
  } else if (identifier === 'daemon' || identifier === 'supervisor') {
    logFile = path.join(root, '.24x7ai', 'logs', 'daemon.log');
  } else {
    // Project specific log
    logFile = path.join(root, identifier, 'agent.log');
    if (!fs.existsSync(logFile)) {
      logFile = path.join(root, '.24x7ai', 'logs', `${identifier}.log`);
    }
  }

  if (!fs.existsSync(logFile)) {
    console.error(pc.red(`Log file not found: ${logFile}`));
    process.exitCode = 1;
    return;
  }

  const args = ['-n', '100'];
  if (options?.follow) {
    args.push('-f');
  }
  args.push(logFile);

  const proc = spawn('tail', args, { stdio: 'inherit' });
  proc.on('close', (code) => {
    process.exitCode = code ?? 0;
  });
}
