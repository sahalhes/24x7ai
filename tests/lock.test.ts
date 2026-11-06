import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileLock, withLock } from '../src/utils/lock.js';

describe('FileLock (crash-safe stale recovery)', () => {
  let tmpDir: string;
  let lockPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '24x7ai-lock-test-'));
    lockPath = path.join(tmpDir, 'fleet.lock');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('acquires and releases, removing the lock file', () => {
    const lock = new FileLock(lockPath);
    expect(lock.isLocked()).toBe(false);
    expect(lock.acquire()).toBe(true);
    expect(lock.isLocked()).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8')).toContain(String(process.pid));

    lock.release();
    expect(lock.isLocked()).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('blocks a second acquire while the first lock is held', () => {
    const first = new FileLock(lockPath);
    const second = new FileLock(lockPath);
    expect(first.acquire()).toBe(true);
    expect(second.acquire()).toBe(false);
    expect(second.isLocked()).toBe(false);
    first.release();
    expect(second.acquire()).toBe(true);
    second.release();
  });

  it('reclaims a stale lock left by a dead PID', () => {
    fs.writeFileSync(lockPath, '999999999\n2026-11-06T00:00:00.000Z\n');
    const lock = new FileLock(lockPath);
    expect(lock.acquire()).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8')).toContain(String(process.pid));
    lock.release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('reclaims malformed lock files instead of deadlocking', () => {
    const malformed = ['', 'not-a-pid\n', '0\n', '-42\n', '  \n', '123abc\n'];
    for (const content of malformed) {
      fs.writeFileSync(lockPath, content);
      const lock = new FileLock(lockPath);
      expect(lock.acquire(), `malformed content ${JSON.stringify(content)} should be reclaimed`).toBe(true);
      expect(fs.readFileSync(lockPath, 'utf8')).toContain(String(process.pid));
      lock.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    }
  });

  it('does not treat a live PID lock file as stale', () => {
    fs.writeFileSync(lockPath, `${process.pid}\n2026-11-06T00:00:00.000Z\n`);
    const lock = new FileLock(lockPath);
    expect(lock.acquire()).toBe(false);
    expect(lock.isLocked()).toBe(false);
    // Untouched — still owned by the live PID.
    expect(fs.readFileSync(lockPath, 'utf8')).toContain(String(process.pid));
  });

  it('release preserves a replacement lock file owned by another PID', () => {
    const lock = new FileLock(lockPath);
    expect(lock.acquire()).toBe(true);
    // Simulate another owner replacing the file while we hold the lock.
    fs.writeFileSync(lockPath, '999999999\n2026-11-06T00:00:00.000Z\n');
    lock.release();
    expect(lock.isLocked()).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8')).toContain('999999999');
  });

  it('withLock returns the result and releases the lock', async () => {
    const res = await withLock(lockPath, async () => 'ok');
    expect(res.acquired).toBe(true);
    expect(res.result).toBe('ok');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('withLock does not run the callback when the lock is held', async () => {
    const held = new FileLock(lockPath);
    expect(held.acquire()).toBe(true);
    let ran = false;
    const res = await withLock(lockPath, async () => {
      ran = true;
      return 'should-not-run';
    });
    expect(res.acquired).toBe(false);
    expect(res.result).toBeUndefined();
    expect(ran).toBe(false);
    held.release();
  });

  it('withLock releases the lock when the callback throws', async () => {
    await expect(
      withLock(lockPath, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(fs.existsSync(lockPath)).toBe(false);
    const next = new FileLock(lockPath);
    expect(next.acquire()).toBe(true);
    next.release();
  });
});
