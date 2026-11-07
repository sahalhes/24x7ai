import pc from 'picocolors';
import { defaultRegistry } from '../../adapters/registry.js';
import { resolveProjectsRoot } from '../../config/loader.js';

export async function handleAdapterCommand(
  action: 'list' | 'test' | 'info',
  name?: string,
  options?: { projectsDir?: string }
): Promise<void> {
  if (action === 'list') {
    console.log(pc.cyan('\n24x7ai Agent Adapters:'));
    const detected = await defaultRegistry.detectAvailable();

    for (const item of detected) {
      const status = item.available ? pc.green('INSTALLED') : pc.gray('NOT DETECTED');
      console.log(`  ${pc.bold(item.adapter.name.padEnd(14))} ${status.padEnd(16)} ${item.adapter.description}`);
    }
    console.log('');
    return;
  }

  if (action === 'info') {
    if (!name) {
      console.error(pc.red("Error: Adapter name is required for 'adapter info <name>'"));
      process.exitCode = 1;
      return;
    }
    const adapter = defaultRegistry.get(name);
    const available = await adapter.detect();
    console.log(pc.cyan(`\nAdapter: ${adapter.name}`));
    console.log(`  Description: ${adapter.description}`);
    console.log(`  Available:   ${available ? pc.green('YES') : pc.red('NO')}\n`);
    return;
  }

  if (action === 'test') {
    if (!name) {
      console.error(pc.red("Error: Adapter name is required for 'adapter test <name>'"));
      process.exitCode = 1;
      return;
    }

    const root = resolveProjectsRoot(options?.projectsDir);
    console.log(pc.cyan(`Testing adapter "${name}" in ${root}...`));

    try {
      const outcome = await defaultRegistry.testAdapter(name, root);
      if (outcome.success) {
        console.log(pc.green(`✓ Adapter "${name}" tested successfully.`));
        console.log(`  Exit code: ${outcome.result.exitCode}`);
        console.log(`  Duration: ${outcome.result.duration}ms`);
      } else {
        console.log(pc.red(`✗ Adapter "${name}" test failed.`));
        console.log(`  Error: ${outcome.result.error || 'Non-zero exit'}`);
      }
    } catch (err: any) {
      console.error(pc.red(`Error: ${err.message}`));
      process.exitCode = 1;
    }
  }
}
