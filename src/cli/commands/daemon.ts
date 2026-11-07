import pc from 'picocolors';
import { loadConfig, resolveProjectsRoot } from '../../config/loader.js';
import { getDb } from '../../state/db.js';
import { FleetStore } from '../../state/queries.js';
import { DaemonManager } from '../../core/daemon-manager.js';

export async function handleDaemonCommand(
  action: 'start' | 'stop' | 'pause' | 'resume' | 'restart' | 'run' | 'supervise' | 'list',
  identifier?: string,
  options?: { projectsDir?: string; status?: string }
): Promise<void> {
  const root = resolveProjectsRoot(options?.projectsDir);
  const config = loadConfig(root);
  const db = getDb(root);
  const store = new FleetStore(db);
  const daemonManager = new DaemonManager({ config, store });

  if (action === 'supervise') {
    console.log(pc.cyan(`Running fleet supervision in ${root}...`));
    const res = await daemonManager.supervise();
    console.log(pc.green(`✓ Supervision complete: ${res.executed} executed, ${res.skipped} skipped, ${res.errors} errors.`));
    return;
  }

  if (action === 'list') {
    let projects = store.listProjects();
    if (options?.status) {
      projects = projects.filter(p => p.daemon_status === options.status);
    }
    console.log(pc.cyan(`\nActive Fleet Daemons: ${root}`));
    for (const p of projects) {
      if (p.daemon_active) {
        console.log(`  #${p.sl_no} ${p.slug} [${p.daemon_status}] schedule: ${p.daemon_schedule} next: ${p.next_run_at || 'now'}`);
      }
    }
    console.log('');
    return;
  }

  if (!identifier) {
    console.error(pc.red(`Error: Project identifier (slug or sl_no) is required for 'daemon ${action}'`));
    process.exitCode = 1;
    return;
  }

  try {
    if (action === 'start') {
      const p = daemonManager.start(identifier);
      console.log(pc.green(`✓ Started daemon for ${p.slug} (sl_no: ${p.sl_no})`));
    } else if (action === 'stop') {
      const p = daemonManager.stop(identifier);
      console.log(pc.yellow(`✓ Stopped daemon for ${p.slug} (sl_no: ${p.sl_no})`));
    } else if (action === 'pause') {
      const p = daemonManager.pause(identifier);
      console.log(pc.gray(`✓ Paused daemon for ${p.slug} (sl_no: ${p.sl_no})`));
    } else if (action === 'restart') {
      const p = daemonManager.restart(identifier);
      console.log(pc.green(`✓ Restarted daemon for ${p.slug} (sl_no: ${p.sl_no})`));
    } else if (action === 'resume') {
      const p = daemonManager.resume(identifier);
      console.log(pc.green(`✓ Resumed daemon for ${p.slug} (sl_no: ${p.sl_no})`));
    } else if (action === 'run') {
      const project = store.getProjectBySlug(identifier) || store.getProjectById(Number(identifier));
      if (!project) throw new Error(`Project not found: ${identifier}`);
      console.log(pc.cyan(`Executing immediate daemon run for ${project.slug}...`));
      const ok = await daemonManager.runSingleDaemon(project);
      if (ok) console.log(pc.green(`✓ Daemon run succeeded for ${project.slug}`));
      else console.log(pc.red(`✗ Daemon run failed or skipped for ${project.slug}`));
    }
  } catch (err: any) {
    console.error(pc.red(`Error: ${err.message}`));
    process.exitCode = 1;
  }
}
