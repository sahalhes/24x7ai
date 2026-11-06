import pc from 'picocolors';
import { loadConfig, resolveProjectsRoot } from '../../config/loader.js';
import { getDb } from '../../state/db.js';
import { FleetStore } from '../../state/queries.js';
import { MvpPipeline } from '../../core/pipeline.js';

export async function runMvpPipeline(projectsDir?: string, options?: { maxParallel?: number }): Promise<void> {
  const root = resolveProjectsRoot(projectsDir);
  const config = loadConfig(root);
  if (options?.maxParallel) config.maxParallel = options.maxParallel;

  const db = getDb(root);
  const store = new FleetStore(db);
  const pipeline = new MvpPipeline({ config, store });

  console.log(pc.cyan(`\nStarting 24x7ai MVP Pipeline in ${root}...`));
  const outcome = await pipeline.run();

  if (outcome) {
    console.log(pc.green(`\n✓ Successfully processed Sl No ${outcome.project.sl_no}: ${outcome.project.slug}`));
    console.log(`  Duration: ${(outcome.run.duration_ms || 0) / 1000}s`);
    console.log(`  Commits produced: ${outcome.commitsProduced}`);
    console.log(`  MVP Complete: ${outcome.mvpCompleted ? pc.green('YES') : pc.yellow('In Progress')}\n`);
  } else {
    console.log(pc.gray('\nPipeline step completed. No eligible uncompleted projects or lock held.\n'));
  }
}
