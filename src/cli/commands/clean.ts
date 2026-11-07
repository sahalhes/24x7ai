import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { resolveProjectsRoot } from '../../config/loader.js';

export function runClean(projectsDir?: string): void {
  const root = resolveProjectsRoot(projectsDir);
  const lockDir = path.join(root, '.24x7ai', 'locks');
  let removedLocks = 0;

  if (fs.existsSync(lockDir)) {
    for (const file of fs.readdirSync(lockDir)) {
      if (file.endsWith('.lock')) {
        const full = path.join(lockDir, file);
        try {
          const content = fs.readFileSync(full, 'utf8');
          const pid = parseInt(content.split('\n')[0], 10);
          let isRunning = false;
          if (!isNaN(pid)) {
            try { process.kill(pid, 0); isRunning = true; } catch {}
          }
          if (!isRunning) {
            fs.unlinkSync(full);
            removedLocks++;
          }
        } catch {}
      }
    }
  }

  console.log(pc.green(`✓ Cleaned ${removedLocks} stale lockfiles in ${root}`));
}
