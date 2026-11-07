import { spawnSync } from 'node:child_process';
import pc from 'picocolors';
import { defaultRegistry } from '../../adapters/registry.js';

export async function runDoctor(): Promise<void> {
  console.log(pc.cyan('\n24x7ai Fleet Diagnostics\n'));

  // 1. Node.js check
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split('.')[0], 10);
  if (major >= 18) {
    console.log(pc.green('  ✓ Node.js: ') + nodeVer + pc.gray(' (supported)'));
  } else {
    console.log(pc.red('  ✗ Node.js: ') + nodeVer + pc.yellow(' (requires Node.js 18+)'));
  }

  // 2. Git check
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.status === 0) {
    console.log(pc.green('  ✓ Git: ') + git.stdout.trim());
  } else {
    console.log(pc.red('  ✗ Git: not found in PATH'));
  }

  // 3. GitHub CLI check
  const gh = spawnSync('gh', ['--version'], { encoding: 'utf8' });
  if (gh.status === 0) {
    const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
    const authOk = auth.status === 0;
    console.log(pc.green('  ✓ GitHub CLI: ') + gh.stdout.split('\n')[0] + (authOk ? pc.green(' (authenticated)') : pc.yellow(' (unauthenticated)')));
  } else {
    console.log(pc.yellow('  ! GitHub CLI: not installed (optional for remote pushes)'));
  }

  // 4. Crontab check
  const cron = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  if (cron.status === 0 || !cron.stderr?.includes('not found')) {
    console.log(pc.green('  ✓ Crontab: available for fleet scheduling'));
  } else {
    console.log(pc.yellow('  ! Crontab: unavailable or restricted'));
  }

  // 5. Adapters check
  console.log(pc.cyan('\nAgent Adapters:'));
  const detected = await defaultRegistry.detectAvailable();
  for (const item of detected) {
    if (item.available) {
      console.log(pc.green('  ✓ ') + pc.bold(item.adapter.name.padEnd(14)) + pc.gray(item.adapter.description));
    } else {
      console.log(pc.gray('  - ' + item.adapter.name.padEnd(14) + item.adapter.description));
    }
  }

  console.log('\n' + pc.green('System check complete.\n'));
}
