import fs from 'node:fs';
import path from 'node:path';
import handlebars from 'handlebars';
import { AppConfig } from '../config/schema.js';
import { FleetStore } from '../state/queries.js';
import { ProjectRecord, AgentRunRecord } from '../state/models.js';
import { AdapterRegistry, defaultRegistry } from '../adapters/registry.js';
import { loadIdeas } from '../csv/sources.js';
import { IdeaItem } from '../csv/parser.js';
import { ensureGitRepo, ensureDevBranch, commitWorkingTree, syncGitHubRepo } from '../github/repo.js';
import { OtariGateway } from '../gateway/otari.js';
import { Logger } from '../utils/logger.js';
import { withLock } from '../utils/lock.js';

export interface PipelineOptions {
  config: AppConfig;
  store: FleetStore;
  registry?: AdapterRegistry;
  logger?: Logger;
  slNo?: number; // optionally run specific idea sl_no
  dryRun?: boolean;
}

export interface PipelineRunOutcome {
  project: ProjectRecord;
  run: AgentRunRecord;
  mvpCompleted: boolean;
  commitsProduced: number;
}

export class MvpPipeline {
  private config: AppConfig;
  private store: FleetStore;
  private registry: AdapterRegistry;
  private logger: Logger;
  private otari: OtariGateway;

  constructor(opts: PipelineOptions) {
    this.config = opts.config;
    this.store = opts.store;
    this.registry = opts.registry || defaultRegistry;
    this.logger = opts.logger || new Logger(
      path.join(this.config.projectsRoot, '.24x7ai', 'logs', 'pipeline.log'),
      'pipeline'
    );
    this.otari = new OtariGateway(this.config.otari);
  }

  async run(): Promise<PipelineRunOutcome | null> {
    const lockFile = path.join(this.config.projectsRoot, '.24x7ai', 'master.lock');

    const lockResult = await withLock(lockFile, async () => {
      return this.executePipelineStep();
    });

    if (!lockResult.acquired) {
      this.logger.warn('Another pipeline process is currently running (master lock held). Skipping.');
      return null;
    }

    return lockResult.result || null;
  }

  private async executePipelineStep(): Promise<PipelineRunOutcome | null> {
    this.logger.info(`Loading ideas from ${this.config.ideaSourceType}: ${this.config.ideaSource}`);
    const ideas = await loadIdeas(
      this.config.ideaSourceType,
      this.config.ideaSource,
      this.config.projectsRoot
    );

    if (ideas.length === 0) {
      this.logger.warn('No ideas found in CSV source.');
      return null;
    }

    // Ingest ideas into DB
    for (const item of ideas) {
      this.store.upsertProject({
        slug: item.slug,
        idea: item.idea,
        sl_no: item.sl_no,
        source_csv: this.config.ideaSource,
      });
    }

    // Select next project:
    // 1. Any project currently active but mvp_complete = false
    // 2. Otherwise lowest sl_no with mvp_complete = false
    const allProjects = this.store.listProjects();
    const incomplete = allProjects.filter((p) => !p.mvp_complete);

    if (incomplete.length === 0) {
      this.logger.info('All projects have completed MVP! Fleet is fully initialized.');
      return null;
    }

    const selected = incomplete[0];
    this.logger.info(`Selected project Sl No ${selected.sl_no}: "${selected.idea}" (${selected.slug})`);
    if (this.config.dryRun || (this as any).dryRun) {
      this.logger.info(`[DRY RUN] Would execute MVP for Sl No ${selected.sl_no} (${selected.slug}) using adapter "${this.config.defaultAdapter}"`);
      return null;
    }

    const projectDir = path.join(this.config.projectsRoot, selected.slug);
    fs.mkdirSync(projectDir, { recursive: true });

    // Initialize git repository and dev branch
    await ensureGitRepo(projectDir);
    await ensureDevBranch(projectDir);

    // Render templates
    this.renderTemplates(projectDir, selected);

    // Save source metadata
    fs.writeFileSync(
      path.join(projectDir, '.project-source.json'),
      JSON.stringify(selected, null, 2) + '\n'
    );

    // Check Otari budget
    const budgetCheck = await this.otari.checkBudget();
    if (!budgetCheck.allowed) {
      this.logger.error(`Otari budget cap reached. Halting MVP pipeline.`);
      throw new Error('Otari budget cap exceeded');
    }

    // Prepare agent prompt
    const prompt = this.buildMvpPrompt(selected);

    // Get adapter
    const adapterName = this.config.defaultAdapter || 'opencode';
    const adapter = this.registry.get(adapterName);
    this.logger.info(`Invoking adapter "${adapter.name}" in ${projectDir}`);

    // Start DB run record
    const runRecord = this.store.startAgentRun({
      project_id: selected.id,
      adapter: adapter.name,
      prompt,
      run_type: 'mvp',
    });

    const gatewayEnv = this.otari.getAdapterEnv(selected.id, 'mvp');

    // Run agent
    const result = await adapter.invoke({
      projectDir,
      prompt,
      timeout: this.config.stuckTimeoutMs,
      args: this.config.adapterArgs,
      commandOverride: this.config.adapterCommand,
      env: gatewayEnv,
      onStdout: (chunk) => this.logger.debug(chunk.trim()),
      onStderr: (chunk) => this.logger.warn(chunk.trim()),
    });

    // Check .agent-status.json
    const status = await adapter.parseStatus(projectDir);
    const mvpComplete = status?.mvp_complete === true;

    // Finish run record
    const finishedRun = this.store.finishAgentRun(runRecord.id, {
      exit_code: result.exitCode,
      duration_ms: result.duration,
      commits_produced: result.commits.length,
      files_changed: result.filesChanged.length,
      error: result.error,
    });

    // Commit any uncommitted changes produced by the agent
    const newSha = await commitWorkingTree(
      projectDir,
      `feat: autonomous MVP progress for idea ${selected.sl_no} (${selected.slug})`
    );
    if (newSha) {
      this.logger.info(`Committed changes: ${newSha}`);
    }

    // Sync with GitHub if configured
    if (this.config.github.owner) {
      await syncGitHubRepo(projectDir, selected.slug, this.config.github, this.logger);
    }

    if (mvpComplete) {
      this.logger.info(`MVP Complete for idea ${selected.sl_no}: ${selected.slug}! Activating daemon.`);
      this.store.setMvpComplete(selected.id, true);
    } else {
      this.logger.info(`MVP progress recorded for idea ${selected.sl_no} (mvp_complete: false).`);
    }

    return {
      project: selected,
      run: finishedRun,
      mvpCompleted: mvpComplete,
      commitsProduced: result.commits.length + (newSha ? 1 : 0),
    };
  }

  private renderTemplates(projectDir: string, project: ProjectRecord): void {
    const pkgRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
    const templatesDir = path.join(pkgRoot, 'templates');

    const agentsHbs = path.join(templatesDir, 'AGENTS.md.hbs');
    const autoHbs = path.join(templatesDir, 'AUTODEVELOP.md.hbs');

    const agentsDest = path.join(projectDir, 'AGENTS.md');
    const autoDest = path.join(projectDir, 'AUTODEVELOP.md');

    if (!fs.existsSync(agentsDest) && fs.existsSync(agentsHbs)) {
      const template = handlebars.compile(fs.readFileSync(agentsHbs, 'utf8'));
      fs.writeFileSync(agentsDest, template(project));
    }

    if (!fs.existsSync(autoDest) && fs.existsSync(autoHbs)) {
      const template = handlebars.compile(fs.readFileSync(autoHbs, 'utf8'));
      fs.writeFileSync(autoDest, template(project));
    }
  }

  private buildMvpPrompt(project: ProjectRecord): string {
    const parts: string[] = [];
    if (this.config.promptPrefix) parts.push(this.config.promptPrefix);
    parts.push(
      `Read AGENTS.md, AUTODEVELOP.md and .project-source.json.`,
      `Build or continue the smallest genuinely useful working MVP for idea Sl No ${project.sl_no}: "${project.idea}".`,
      `Inspect and preserve existing work. Work only in this repository on dev.`,
      `Implement actual code, write a clear README documenting setup and usage, and run relevant local checks.`,
      `Maintain valid .agent-status.json with sl_no, project, status, mvp_complete, development_complete, branch, last_run, next_action and blocked.`,
      `Set mvp_complete true only when the core working software is implemented and local tests/checks pass.`,
      `Never set development_complete merely because the MVP works.`,
      `Leave implementation changes in the working tree.`
    );
    if (this.config.promptSuffix) parts.push(this.config.promptSuffix);
    return parts.join(' ');
  }
}
