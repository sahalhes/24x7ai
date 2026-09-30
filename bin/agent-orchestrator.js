#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0] || 'help';
const ask = readline.createInterface({ input, output });
const say = (s = '') => console.log(s);
const defaultProjects = path.join(os.homedir(), 'projects');
const cronTag = '# agent-orchestrator';

async function prompt(label, fallback = '') {
  const suffix = fallback ? ` [${fallback}]` : '';
  const value = (await ask.question(`${label}${suffix}: `)).trim();
  return value || fallback;
}
function configPath(root) { return path.join(root, '.agent-orchestrator.env'); }
function shellQuote(s) { return `'${String(s).replaceAll("'", "'\\''")}'`; }
function run(command, argv, options = {}) {
  const r = spawnSync(command, argv, { stdio: 'inherit', ...options });
  if (r.error) throw r.error;
  return r.status ?? 1;
}
function readConfig(root) {
  const f = configPath(root);
  if (!fs.existsSync(f)) throw new Error(`No setup found at ${f}. Run: npx agent-orchestrator init`);
  const result = {};
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) result[match[1]] = match[2].replace(/^'|'$/g, '').replaceAll("'\\''", "'");
  }
  return result;
}
function installCron(root, masterSchedule, supervisorSchedule) {
  const master = `${masterSchedule} ${shellQuote(path.join(root, 'run-agent.sh'))} >> ${shellQuote(path.join(root, '.agent-orchestrator/logs/master-cron.log'))} 2>&1`;
  const supervisor = `${supervisorSchedule} ${shellQuote(path.join(root, 'run-sub-agents.sh'))} >> ${shellQuote(path.join(root, '.agent-orchestrator/logs/supervisor-cron.log'))} 2>&1`;
  const existing = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  const lines = (existing.stdout || '').split(/\r?\n/).filter(line => !line.includes(cronTag) && line.trim());
  lines.push(`${master} ${cronTag} master`, `${supervisor} ${cronTag} supervisor`);
  const result = spawnSync('crontab', ['-'], { input: `${lines.join('\n')}\n`, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error('Could not install crontab. Ensure cron/crontab is installed and retry.');
}
async function init() {
  say('\nAgent Orchestrator setup');
  say('This creates two scheduled jobs: idea-to-MVP runs and project-worker supervision.');
  say('Requirements on the host: Node.js 18+, bash, python3, git, curl, flock, and a configured coding-agent CLI.');
  const root = path.resolve(await prompt('Projects directory', defaultProjects));
  const sourceType = await prompt('Idea source (csv-url or local-csv)', 'csv-url');
  if (!['csv-url', 'local-csv'].includes(sourceType)) throw new Error('Choose csv-url or local-csv.');
  let source = await prompt(sourceType === 'csv-url' ? 'CSV URL (Google Sheets links are converted to CSV export URLs)' : 'CSV file path');
  if (!source) throw new Error('An idea source is required.');
  if (sourceType === 'csv-url' && /docs\.google\.com\/spreadsheets\/d\//.test(source) && /\/edit(?:\?|$)/.test(source)) {
    const gid = new URL(source).searchParams.get('gid') || '0';
    source = `${source.split('/edit')[0]}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    say(`Using CSV export URL: ${source}`);
  }
  const agentCommand = await prompt('Coding agent executable', 'codex');
  const agentArgs = await prompt('Extra agent arguments (space-separated; leave empty for defaults)', '');
  const provider = await prompt('Agent mode (codex, opencode, claude, custom)', 'codex');
  const owner = await prompt('GitHub owner (blank disables automatic repository creation)', '');
  const privateRepos = (await prompt('Create repositories as private? (yes/no)', 'yes')).toLowerCase().startsWith('y');
  const masterSchedule = await prompt('Master schedule (cron syntax)', '0 * * * *');
  const supervisorSchedule = await prompt('Project supervision schedule (cron syntax)', '*/15 * * * *');
  const templateRoot = path.join(root, '.agent-orchestrator');
  fs.mkdirSync(path.join(templateRoot, 'logs'), { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  fs.copyFileSync(path.join(pkgRoot, 'templates', 'run-agent.sh'), path.join(root, 'run-agent.sh'));
  fs.copyFileSync(path.join(pkgRoot, 'templates', 'run-sub-agents.sh'), path.join(root, 'run-sub-agents.sh'));
  fs.copyFileSync(path.join(pkgRoot, 'templates', 'next_project.py'), path.join(templateRoot, 'next_project.py'));
  fs.writeFileSync(path.join(root, '.agent-orchestrator.env'), [
    `PROJECTS_ROOT='${root.replaceAll("'", "'\\''")}'`, `IDEA_SOURCE_TYPE='${sourceType}'`,
    `IDEA_SOURCE='${source.replaceAll("'", "'\\''")}'`, `AGENT_PROVIDER='${provider}'`,
    `AGENT_COMMAND='${agentCommand.replaceAll("'", "'\\''")}'`, `AGENT_ARGS='${agentArgs.replaceAll("'", "'\\''")}'`,
    `GITHUB_OWNER='${owner.replaceAll("'", "'\\''")}'`, `GITHUB_PRIVATE='${privateRepos ? 'true' : 'false'}'`, ''
  ].join('\n'), { mode: 0o600 });
  const statePath = path.join(templateRoot, 'state.json');
  if (!fs.existsSync(statePath)) fs.writeFileSync(statePath, JSON.stringify({ current_sl_no: 1, active_mvp: null, last_completed_mvp: null, last_run: null, projects: {} }, null, 2) + '\n');
  if (process.platform !== 'win32') {
    fs.chmodSync(path.join(root, 'run-agent.sh'), 0o755);
    fs.chmodSync(path.join(root, 'run-sub-agents.sh'), 0o755);
  }
  const install = process.platform !== 'win32' && (await prompt('Install/update both cron jobs now? (yes/no)', 'yes')).toLowerCase().startsWith('y');
  if (install) installCron(root, masterSchedule, supervisorSchedule);
  say('\nSetup complete.');
  say(`  Master runner:    ${path.join(root, 'run-agent.sh')}`);
  say(`  Supervisor:       ${path.join(root, 'run-sub-agents.sh')}`);
  say(`  Configuration:    ${path.join(root, '.agent-orchestrator.env')}`);
  say(`  Logs:             ${path.join(templateRoot, 'logs')}`);
  say('\nTry it manually:');
  say(`  cd ${shellQuote(root)} && ./run-agent.sh`);
  say(`  cd ${shellQuote(root)} && ./run-sub-agents.sh`);
}
function cliRun(which) {
  const root = path.resolve(args[1] || process.cwd());
  readConfig(root);
  const script = which === 'run' ? 'run-agent.sh' : 'run-sub-agents.sh';
  process.exitCode = run('bash', [path.join(root, script)], { cwd: root });
}
function status() {
  const root = path.resolve(args[1] || process.cwd());
  const orch = path.join(root, '.agent-orchestrator');
  for (const f of [path.join(orch, 'state.json')]) {
    if (!fs.existsSync(f)) { say('No orchestrator state found. Run init first.'); return; }
    say(fs.readFileSync(f, 'utf8'));
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const f = path.join(root, entry.name, '.agent-status.json');
    if (fs.existsSync(f)) say(`${entry.name}: ${fs.readFileSync(f, 'utf8').trim()}`);
  }
}
function logs() {
  const root = path.resolve(args[1] || process.cwd());
  const file = path.join(root, '.agent-orchestrator', 'logs', args[2] || 'master.log');
  if (!fs.existsSync(file)) throw new Error(`Log not found: ${file}`);
  process.exitCode = run('tail', ['-n', '100', '-f', file]);
}
function setIdeas() {
  const root = path.resolve(args[1] || process.cwd());
  const csv = path.resolve(args[2] || '');
  if (!args[2]) throw new Error('Usage: agent-orchestrator set-ideas <projects-dir> <csv-file>');
  if (!fs.existsSync(csv) || !fs.statSync(csv).isFile()) throw new Error(`CSV file not found: ${csv}`);
  const config = configPath(root);
  if (!fs.existsSync(config)) throw new Error(`No setup found at ${config}. Run init first.`);
  let contents = fs.readFileSync(config, 'utf8');
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  contents = contents.replace(/^IDEA_SOURCE_TYPE=.*$/m, "IDEA_SOURCE_TYPE='local-csv'");
  const encoded = `IDEA_SOURCE=${quote(csv)}`;
  if (/^IDEA_SOURCE=.*$/m.test(contents)) contents = contents.replace(/^IDEA_SOURCE=.*$/m, encoded);
  else contents += `${encoded}\n`;
  fs.writeFileSync(config, contents, { mode: 0o600 });
  say(`Idea source updated to local CSV: ${csv}`);
}
async function main() {
  try {
    if (command === 'init' || command === 'setup') await init();
    else if (command === 'run') cliRun('run');
    else if (command === 'supervise') cliRun('supervise');
    else if (command === 'status') status();
    else if (command === 'logs') logs();
    else if (command === 'set-ideas') setIdeas();
    else if (command === 'cron') {
      const root = path.resolve(args[1] || process.cwd());
      readConfig(root);
      installCron(root, args[2] || '0 * * * *', args[3] || '*/15 * * * *');
      say(`Installed master and supervisor schedules for ${root}.`);
    } else {
      say('Agent Orchestrator Kit\n\nCommands:\n  init                  Guided setup, configuration, and cron installation\n  run [projects-dir]    Run the master idea/MVP worker now\n  supervise [dir]       Discover and start project workers now\n  status [projects-dir] Show queue and project status\n  set-ideas <dir> <csv> Use a local CSV as the idea source\n  logs [dir] [name]     Follow a log (master.log by default)\n  cron [dir] [master] [supervisor]  Install/update both cron entries\n\nInstall/use: npx agent-orchestrator init');
    }
  } catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
  finally { ask.close(); }
}
await main();
