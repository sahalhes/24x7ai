import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { resolveProjectsRoot } from '../../config/loader.js';
import { getDb } from '../../state/db.js';
import { FleetStore } from '../../state/queries.js';

export function runExport(dest?: string, options?: { format?: string; projectsDir?: string }): void {
  const root = resolveProjectsRoot(options?.projectsDir);
  const db = getDb(root);
  const store = new FleetStore(db);
  const projects = store.listProjects();

  const data = JSON.stringify(projects, null, 2);
  if (dest) {
    const full = path.resolve(dest);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data + '\n');
    console.log(pc.green(`✓ Exported ${projects.length} projects to ${full}`));
  } else {
    console.log(data);
  }
}
