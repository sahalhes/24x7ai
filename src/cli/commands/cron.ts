import { spawnSync } from 'node:child_process';
import path from 'node:path';
import pc from 'picocolors';
import { resolveProjectsRoot } from '../../config/loader.js';

export const CRON_TAG = '# 24x7ai-fleet';

export function installFleetCron(
  projectsDir?: string,
  pipelineSchedule = '0 * * * *',
  superviseSchedule = '*/15 * * * *'
): void {
  const root = resolveProjectsRoot(projectsDir);

  const pipelineCmd = `${pipelineSchedule} npx 24x7ai run ${root} >> ${path.join(root, '.24x7ai', 'logs', 'pipeline-cron.log')} 2>&1 ${CRON_TAG} pipeline`;
  const superviseCmd = `${superviseSchedule} npx 24x7ai daemon supervise ${root} >> ${path.join(root, '.24x7ai', 'logs', 'daemon-cron.log')} 2>&1 ${CRON_TAG} supervise`;

  const existing = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  const lines = (existing.stdout || '')
    .split(/\r?\n/)
    .filter((line) => !line.includes(CRON_TAG) && !line.includes('# agent-orchestrator') && line.trim());

  lines.push(pipelineCmd, superviseCmd);

  const res = spawnSync('crontab', ['-'], {
    input: `${lines.join('\n')}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  if (res.status === 0) {
    console.log(pc.green(`✓ Installed cron entries for 24x7ai in ${root}`));
    console.log(`  Pipeline schedule:   ${pipelineSchedule}`);
    console.log(`  Supervisor schedule: ${superviseSchedule}`);
  } else {
    console.error(pc.red('Failed to install crontab entries. Ensure crontab is available.'));
  }
}
