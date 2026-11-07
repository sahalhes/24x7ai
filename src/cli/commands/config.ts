import pc from 'picocolors';
import { loadConfig, saveConfig, resolveProjectsRoot } from '../../config/loader.js';

export function runConfigCommand(action: 'get' | 'set' | 'list', key?: string, value?: string, projectsDir?: string): void {
  const root = resolveProjectsRoot(projectsDir);
  const config = loadConfig(root) as any;

  if (action === 'list') {
    console.log(pc.cyan(`\n24x7ai Configuration (${root}):\n`));
    for (const [k, v] of Object.entries(config)) {
      console.log(`  ${pc.bold(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
    console.log('');
    return;
  }

  if (action === 'get') {
    if (!key) {
      console.error(pc.red('Error: Key is required for config get <key>'));
      process.exitCode = 1;
      return;
    }
    const val = config[key];
    console.log(typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
    return;
  }

  if (action === 'set') {
    if (!key || value === undefined) {
      console.error(pc.red('Error: Key and value are required for config set <key> <val>'));
      process.exitCode = 1;
      return;
    }

    let parsedVal: any = value;
    if (value === 'true') parsedVal = true;
    else if (value === 'false') parsedVal = false;
    else if (!isNaN(Number(value))) parsedVal = Number(value);

    saveConfig(root, { [key]: parsedVal });
    console.log(pc.green(`✓ Updated config ${key} = ${JSON.stringify(parsedVal)}`));
  }
}
