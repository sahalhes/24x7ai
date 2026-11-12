import { Command } from 'commander';
import pc from 'picocolors';
import { AgentFactory } from '../../agents/factory.js';
import { AgentRegistry } from '../../agents/registry.js';
import { AgentRuntimeStore } from '../../agents/store.js';
import { resolveProjectsRoot } from '../../config/loader.js';
import { getDb } from '../../state/db.js';

interface CommandOptions {
  dir?: string;
  json?: boolean;
  limit?: number;
}

function runtimeStore(projectsDir?: string): AgentRuntimeStore {
  return new AgentRuntimeStore(getDb(resolveProjectsRoot(projectsDir)));
}

function registerInitialAgents(store: AgentRuntimeStore): AgentRegistry {
  const registry = new AgentRegistry();
  for (const agent of new AgentFactory().createInitialAgents()) {
    registry.register(agent);
    store.upsertAgent(agent);
  }
  return registry;
}

function listAgents(options: CommandOptions): void {
  const store = runtimeStore(options.dir);
  registerInitialAgents(store);
  const agents = store.listAgents();
  if (options.json) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  console.log(pc.cyan('\n24x7ai Agents:'));
  for (const agent of agents) {
    console.log(`  ${pc.bold(agent.id.padEnd(14))} ${agent.role.padEnd(12)} ${agent.model}  timeout=${agent.timeoutMs}ms`);
  }
  console.log('');
}

function showAgent(id: string, options: CommandOptions): void {
  const store = runtimeStore(options.dir);
  registerInitialAgents(store);
  const agent = store.getAgent(id);
  if (!agent) {
    console.error(pc.red(`Agent "${id}" not found`));
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(agent, null, 2));
    return;
  }
  console.log(pc.cyan(`\nAgent: ${agent.id}`));
  console.log(`  Role:           ${agent.role}`);
  console.log(`  Model:          ${agent.model}`);
  console.log(`  Provider model: ${agent.providerModel}`);
  console.log(`  Timeout:        ${agent.timeoutMs}ms`);
  console.log(`  Instructions:   ${agent.systemInstructions}\n`);
}

function listRuns(options: CommandOptions): void {
  const runs = runtimeStore(options.dir).listRuns({ limit: options.limit ?? 20 });
  if (options.json) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }
  if (runs.length === 0) {
    console.log('No agent task runs found.');
    return;
  }
  console.log(pc.cyan('\n24x7ai Agent Runs:'));
  for (const run of runs) {
    console.log(`  ${run.id}  ${run.status.padEnd(10)} ${run.agentId.padEnd(12)} attempt=${run.attempt} correlation=${run.correlationId}`);
  }
  console.log('');
}

function showRun(id: string, options: CommandOptions): void {
  const run = runtimeStore(options.dir).getRun(id);
  if (!run) {
    console.error(pc.red(`Run "${id}" not found`));
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }
  console.log(pc.cyan(`\nRun: ${run.id}`));
  console.log(`  Agent:       ${run.agentId}`);
  console.log(`  Role:        ${run.role}`);
  console.log(`  Model:       ${run.model}`);
  console.log(`  Status:      ${run.status}`);
  console.log(`  Attempt:     ${run.attempt}/${run.maxRetries + 1}`);
  console.log(`  Correlation: ${run.correlationId}`);
  console.log(`  Created:     ${run.createdAt}`);
  console.log(`  Started:     ${run.startedAt ?? '—'}`);
  console.log(`  Finished:    ${run.finishedAt ?? '—'}`);
  if (run.error) console.log(`  Error:       ${run.error.name}: ${run.error.message}`);
  if (run.result) console.log(`  Output:\n${run.result.output.content}`);
  console.log('');
}

function inspectOptions(command: Command): CommandOptions {
  return command.opts<CommandOptions>();
}

export function registerAgentCommands(program: Command): void {
  const agents = program.command('agents').description('Inspect reusable AI agents');
  agents.command('list')
    .description('List configured agents')
    .option('-d, --dir <dir>', 'Projects directory')
    .option('--json', 'Output JSON')
    .action((_options, command) => listAgents(inspectOptions(command)));
  agents.command('show <id>')
    .description('Show an agent definition')
    .option('-d, --dir <dir>', 'Projects directory')
    .option('--json', 'Output JSON')
    .action((id, _options, command) => showAgent(id, inspectOptions(command)));

  const runs = program.command('runs').description('Inspect agent task runs');
  runs.command('list')
    .description('List agent task runs')
    .option('-d, --dir <dir>', 'Projects directory')
    .option('-l, --limit <n>', 'Maximum runs to show', parseInt)
    .option('--json', 'Output JSON')
    .action((_options, command) => listRuns(inspectOptions(command)));

  const run = program.commands.find((command) => command.name() === 'run');
  if (!run) throw new Error('The run command must be registered before agent run commands');
  run.command('status <run-id>')
    .description('Show agent task run status')
    .option('-d, --dir <dir>', 'Projects directory')
    .option('--json', 'Output JSON')
    .action((id, _options, command) => showRun(id, inspectOptions(command)));
}
