import fs from 'node:fs';
import path from 'node:path';

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

function readLockPid(lockPath: string): number | null {
  let content: string;
  try {
    content = fs.readFileSync(lockPath, 'utf8');
  } catch {
    return null;
  }
  const pidStr = content.split('\n')[0]?.trim() ?? '';
  if (!/^\d+$/.test(pidStr)) return null;
  const pid = parseInt(pidStr, 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  return pid;
}

export class FileLock {
  private fd: number | null = null;
  private locked = false;

  constructor(private lockPath: string) {}

  acquire(): boolean {
    try {
      const dir = path.dirname(this.lockPath);
      fs.mkdirSync(dir, { recursive: true });

      // Stale lock detection: reclaim dead / malformed lock files,
      // respect live lock files, including PIDs we lack permission to signal.
      if (fs.existsSync(this.lockPath)) {
        let content: string | null = null;
        try {
          content = fs.readFileSync(this.lockPath, 'utf8');
        } catch (err: any) {
          if (err?.code !== 'ENOENT') return false;
        }
        if (content !== null) {
          const pidStr = content.split('\n')[0]?.trim() ?? '';
          if (/^\d+$/.test(pidStr)) {
            const pid = parseInt(pidStr, 10);
            if (Number.isSafeInteger(pid) && pid > 0 && isPidAlive(pid)) {
              return false;
            }
            // Dead PID or malformed numeric PID (e.g. 0) — stale.
            try { fs.unlinkSync(this.lockPath); } catch {}
          } else {
            // Malformed lock file (empty, garbage text, negative, non-numeric)
            // — treat as stale instead of deadlocking on 'wx' EEXIST.
            try { fs.unlinkSync(this.lockPath); } catch {}
          }
        }
      }

      try {
        this.fd = fs.openSync(this.lockPath, 'wx');
      } catch (err: any) {
        // EEXIST means another process won the race between stale-check and create.
        return false;
      }
      fs.writeSync(this.fd, `${process.pid}\n${new Date().toISOString()}\n`);
      this.locked = true;
      return true;
    } catch {
      return false;
    }
  }

  release(): void {
    if (!this.locked) return;
    try {
      if (this.fd !== null) {
        try { fs.closeSync(this.fd); } catch {}
        this.fd = null;
      }
      if (fs.existsSync(this.lockPath)) {
        const currentPid = readLockPid(this.lockPath);
        if (currentPid === process.pid) {
          fs.unlinkSync(this.lockPath);
        }
      }
    } catch {
      // ignore
    } finally {
      this.fd = null;
      this.locked = false;
    }
  }

  isLocked(): boolean {
    return this.locked;
  }
}

export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T> | T
): Promise<{ acquired: boolean; result?: T }> {
  const lock = new FileLock(lockPath);
  if (!lock.acquire()) {
    return { acquired: false };
  }
  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    lock.release();
  }
}
