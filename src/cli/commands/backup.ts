import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { resolveProjectsRoot } from '../../config/loader.js';
import { getDbPath, closeDb, initDb } from '../../state/db.js';

export function runBackup(projectsDir?: string, dest?: string): void {
  const root = resolveProjectsRoot(projectsDir);
  const dbPath = getDbPath(root);
  if (!fs.existsSync(dbPath)) {
    console.error(pc.red(`Database not found at ${dbPath}`));
    process.exitCode = 1;
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = dest || path.join(root, '.24x7ai', `fleet-backup-${timestamp}.db`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(dbPath, target);
  console.log(pc.green(`✓ Backup saved to: ${target}`));
}

export function runRestore(backupFile: string, projectsDir?: string): void {
  const root = resolveProjectsRoot(projectsDir);
  const dbPath = getDbPath(root);

  if (!fs.existsSync(backupFile)) {
    console.error(pc.red(`Backup file not found: ${backupFile}`));
    process.exitCode = 1;
    return;
  }

  closeDb();
  fs.copyFileSync(backupFile, dbPath);
  initDb(dbPath);
  console.log(pc.green(`✓ Restored database from ${backupFile} to ${dbPath}`));
}
