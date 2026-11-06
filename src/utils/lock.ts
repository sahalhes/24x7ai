import fs from 'node:fs';
import path from 'node:path';

export class FileLock {
  private fd: number | null = null;
  private locked = false;

  constructor(private lockPath: string) {}

  acquire(): boolean {
    try {
      const dir = path.dirname(this.lockPath);
      fs.mkdirSync(dir, { recursive: true });

      // Stale lock detection
      if (fs.existsSync(this.lockPath)) {
        try {
          const content = fs.readFileSync(this.lockPath, 'utf8');
          const [pidStr] = content.split('\n');
          const pid = parseInt(pidStr, 10);
          if (!isNaN(pid)) {
            try {
              process.kill(pid, 0);
              // Process is still running, lock is held
              return false;
            } catch {
              // Process is dead, remove stale lock
              try { fs.unlinkSync(this.lockPath); } catch {}
            }
          }
        } catch {
          // ignore read error
        }
      }

      this.fd = fs.openSync(this.lockPath, 'wx');
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
        fs.closeSync(this.fd);
        this.fd = null;
      }
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // ignore
    } finally {
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
