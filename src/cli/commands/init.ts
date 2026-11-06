import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import pc from 'picocolors';
import { loadConfig, saveConfig, resolveProjectsRoot } from '../../config/loader.js';
import { AppConfig, DEFAULT_CONFIG } from '../../config/schema.js';
import { convertGoogleSheetsUrl } from '../../csv/sources.js';
import { defaultRegistry } from '../../adapters/registry.js';
import { installFleetCron } from './cron.js';

export async function runInit(targetDir?: string): Promise<void> {
  const rl = readline.createInterface({ input, output });

  async function prompt(question: string, defaultValue = ''): Promise<string> {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue;
  }

  try {
    console.log(pc.cyan('\n24x7ai v2 — Universal Agent Fleet Controller Setup'));
    console.log(pc.gray('Configure your autonomous idea-to-MVP factory and fleet daemons.\n'));

    const rootInput = await prompt('Projects directory', targetDir || DEFAULT_CONFIG.projectsRoot);
    const projectsRoot = resolveProjectsRoot(rootInput);

    const existingConfig = loadConfig(projectsRoot);

    const sourceTypeInput = await prompt('Idea source type (local-csv, csv-url, google-sheets)', existingConfig.ideaSourceType);
    let sourceType: AppConfig['ideaSourceType'] = 'local-csv';
    if (sourceTypeInput === 'csv-url' || sourceTypeInput === 'google-sheets') {
      sourceType = sourceTypeInput;
    }

    let source = await prompt(
      sourceType === 'local-csv' ? 'CSV file path' : 'CSV or Google Sheets URL',
      existingConfig.ideaSource
    );
    if (sourceType === 'google-sheets' || sourceType === 'csv-url') {
      source = convertGoogleSheetsUrl(source);
    }

    // Detect available adapters
    const detected = await defaultRegistry.detectAvailable();
    const availableNames = detected.filter((d) => d.available).map((d) => d.adapter.name);
    console.log(pc.gray(`Detected adapters on host: ${availableNames.join(', ') || 'none'}`));

    const defaultAdapter = await prompt('Default agent adapter', existingConfig.defaultAdapter);
    const adapterCommand = await prompt('Custom agent command (optional, press enter to skip)', existingConfig.adapterCommand || '');

    const githubOwner = await prompt('GitHub owner / org (blank disables automatic remote pushes)', existingConfig.github.owner || '');
    let privateRepos = true;
    if (githubOwner) {
      const privInput = await prompt('Create GitHub repositories as private? (yes/no)', 'yes');
      privateRepos = privInput.toLowerCase().startsWith('y');
    }

    // Otari gateway
    const enableOtari = (await prompt('Enable Otari model gateway proxy? (yes/no)', existingConfig.otari.enabled ? 'yes' : 'no')).toLowerCase().startsWith('y');
    let otariEndpoint = existingConfig.otari.endpoint;
    if (enableOtari) {
      otariEndpoint = await prompt('Otari gateway endpoint', otariEndpoint);
    }

    // Save config
    const updated = saveConfig(projectsRoot, {
      projectsRoot,
      ideaSourceType: sourceType,
      ideaSource: source,
      defaultAdapter,
      adapterCommand: adapterCommand || undefined,
      github: {
        owner: githubOwner || undefined,
        privateRepos,
        autoPush: Boolean(githubOwner),
      },
      otari: {
        enabled: enableOtari,
        endpoint: otariEndpoint,
      },
    });

    console.log(pc.green('\n✓ Configuration saved to: ') + path.join(projectsRoot, '.24x7ai.config.json'));

    // Offer cron installation
    if (process.platform !== 'win32') {
      const installCron = (await prompt('Install scheduled cron jobs for fleet? (yes/no)', 'no')).toLowerCase().startsWith('y');
      if (installCron) {
        installFleetCron(projectsRoot);
      }
    }

    console.log(pc.cyan('\nReady! Try running:'));
    console.log(`  npx 24x7ai run ${projectsRoot}      ${pc.gray('# Run serial MVP pipeline')}`);
    console.log(`  npx 24x7ai fleet ${projectsRoot}    ${pc.gray('# Launch TUI fleet controller')}`);
    console.log(`  npx 24x7ai status ${projectsRoot}   ${pc.gray('# Check fleet status table')}\n`);
  } finally {
    rl.close();
  }
}
