import pc from 'picocolors';
import { loadConfig, resolveProjectsRoot } from '../../config/loader.js';
import { getDb } from '../../state/db.js';
import { FleetStore } from '../../state/queries.js';

export function runStatus(projectsDir?: string, options?: { json?: boolean }): void {
  if (options?.json) {
    const root = resolveProjectsRoot(projectsDir);
    const db = getDb(root);
    const store = new FleetStore(db);
    const summary = store.getFleetSummary();
    const projects = store.listProjects();
    console.log(JSON.stringify({ summary, projects }, null, 2));
    return;
  }
  const root = resolveProjectsRoot(projectsDir);
  const db = getDb(root);
  const store = new FleetStore(db);

  const summary = store.getFleetSummary();
  const projects = store.listProjects();

  console.log(pc.cyan(`\n24x7ai Fleet Status: ${root}`));
  console.log(
    `Total: ${summary.totalProjects} | MVP Complete: ${summary.mvpCompleted} | Active Daemons: ${summary.activeDaemons} | Running: ${summary.runningCount} | Stuck: ${summary.stuckCount}\n`
  );

  if (projects.length === 0) {
    console.log(pc.gray('No projects found in fleet database.'));
    return;
  }

  // Column widths
  const pad = (s: any, len: number) => String(s ?? '').padEnd(len).slice(0, len);

  console.log(
    pc.bold(
      `${pad('#', 4)} ${pad('Slug', 28)} ${pad('MVP', 10)} ${pad('Daemon', 10)} ${pad('Next Run', 16)} ${pad('Commits', 8)}`
    )
  );
  console.log(pc.gray('-'.repeat(80)));

  for (const p of projects) {
    const mvpStr = p.mvp_complete ? pc.green('DONE') : pc.yellow('PENDING');
    let daemonStr = pc.gray('OFF');
    if (p.daemon_active) {
      if (p.daemon_status === 'running') daemonStr = pc.yellow('RUNNING');
      else if (p.daemon_status === 'stuck') daemonStr = pc.red('STUCK');
      else if (p.daemon_status === 'paused') daemonStr = pc.gray('PAUSED');
      else daemonStr = pc.green('IDLE');
    }

    const nextRun = p.next_run_at ? new Date(p.next_run_at).toLocaleTimeString() : '—';

    console.log(
      `${pad(p.sl_no, 4)} ${pad(p.slug, 28)} ${pad(mvpStr, 19)} ${pad(daemonStr, 19)} ${pad(nextRun, 16)} ${pad(p.last_run_commits, 8)}`
    );
  }
  console.log('');
}
