#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runMvpPipeline } from './commands/run.js';
import { runFleetTui } from './commands/fleet.js';
import { runStatus } from './commands/status.js';
import { handleDaemonCommand } from './commands/daemon.js';
import { handleAdapterCommand } from './commands/adapter.js';
import { runLogs } from './commands/logs.js';
import { runSetIdeas } from './commands/set-ideas.js';
import { installFleetCron } from './commands/cron.js';
import { runDoctor } from './commands/doctor.js';
import { runConfigCommand } from './commands/config.js';
import { runClean } from './commands/clean.js';
import { runBackup, runRestore } from './commands/backup.js';
import { runExport } from './commands/export.js';
import { registerAgentCommands } from './commands/agents.js';
import { setLogVerbosity } from '../utils/logger.js';

const program = new Command();

program
  .name('24x7ai')
  .description('Universal Agent Fleet Controller — 1 package, 1 vps, 1 command')
  .version('2.0.0')
  .option('--silent', 'Suppress all non-error output')
  .option('--verbose', 'Enable verbose debugging logs')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    setLogVerbosity({ silent: opts.silent, verbose: opts.verbose });
  });

program
  .command('init [dir]')
  .description('Interactive guided setup for projects, ideas, adapters and schedules')
  .action(async (dir) => {
    await runInit(dir);
  });

program
  .command('run [dir]')
  .description('Run the serial MVP pipeline to process ideas from CSV')
  .option('-p, --max-parallel <n>', 'Maximum parallel executions', parseInt)
  .option('--dry-run', 'Preview next eligible idea without executing agent')
  .action(async (dir, opts) => {
    await runMvpPipeline(dir, opts);
  });

program
  .command('fleet [dir]')
  .description('Launch the live Ink TUI Fleet Controller dashboard')
  .action(async (dir) => {
    await runFleetTui(dir);
  });

program
  .command('status [dir]')
  .description('Display fleet status table and recent runs')
  .option('--json', 'Output fleet status in JSON format')
  .option('-l, --limit <n>', 'Limit number of projects shown', parseInt)
  .action((dir, opts) => {
    runStatus(dir, opts);
  });

program
  .command('daemon <action> [target]')
  .description('Manage per-project daemons (start, stop, pause, resume, restart, run, supervise, list)')
  .option('-d, --dir <dir>', 'Projects directory')
  .option('-s, --status <status>', 'Filter daemons by status (idle, running, stuck, paused)')
  .action(async (action, target, opts) => {
    await handleDaemonCommand(action as any, target, { projectsDir: opts.dir, status: opts.status });
  });

program
  .command('supervise [dir]')
  .description('Run a supervision pass across all active project daemons')
  .action(async (dir) => {
    await handleDaemonCommand('supervise', undefined, { projectsDir: dir });
  });

program
  .command('adapter <action> [name]')
  .description('Inspect or test agent adapters (list, test, info)')
  .option('-d, --dir <dir>', 'Projects directory')
  .action(async (action, name, opts) => {
    await handleAdapterCommand(action as any, name, { projectsDir: opts.dir });
  });

program
  .command('logs [target]')
  .description('Follow or view fleet or project agent logs')
  .option('-f, --follow', 'Follow log stream')
  .option('-d, --dir <dir>', 'Projects directory')
  .action((target, opts) => {
    runLogs(target, { follow: opts.follow, projectsDir: opts.dir });
  });

program
  .command('set-ideas <source> [dir]')
  .description('Update idea source to a local CSV, URL or Google Sheets')
  .action((source, dir) => {
    runSetIdeas(source, dir);
  });

program
  .command('cron [dir] [pipelineSchedule] [superviseSchedule]')
  .description('Install or update system cron entries for automated fleet execution')
  .action((dir, pSched, sSched) => {
    installFleetCron(dir, pSched, sSched);
  });

program
  .command('doctor')
  .description('Run system diagnostic check for host dependencies')
  .action(async () => {
    await runDoctor();
  });

program
  .command('config <action> [key] [val]')
  .description('Inspect or modify configuration (get, set, list)')
  .option('-d, --dir <dir>', 'Projects directory')
  .action((action, key, val, opts) => {
    runConfigCommand(action as any, key, val, opts.dir);
  });

program
  .command('clean [dir]')
  .description('Purge stale lockfiles and temporary execution state')
  .action((dir) => {
    runClean(dir);
  });

program
  .command('backup [dir] [dest]')
  .description('Create a timestamped snapshot backup of fleet database')
  .action((dir, dest) => {
    runBackup(dir, dest);
  });

program
  .command('restore <file> [dir]')
  .description('Restore fleet database from snapshot backup')
  .action((file, dir) => {
    runRestore(file, dir);
  });

program
  .command('export [dest]')
  .description('Export fleet projects and metadata to JSON file or stdout')
  .option('-d, --dir <dir>', 'Projects directory')
  .action((dest, opts) => {
    runExport(dest, { projectsDir: opts.dir });
  });

registerAgentCommands(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
