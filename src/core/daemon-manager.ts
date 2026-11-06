import fs from 'node:fs';
import path from 'node:path';
import { AppConfig } from '../config/schema.js';
import { FleetStore } from '../state/queries.js';
import { ProjectRecord, DaemonStatus } from '../state/models.js';
import { AdapterRegistry, defaultRegistry } from '../adapters/registry.js';
import { ensureGitRepo, ensureDevBranch, commitWorkingTree, syncGitHubRepo } from '../github/repo.js';
import { fetchProjectIssues } from '../github/issues.js';
import { createPullRequest } from '../github/pr.js';
import { OtariGateway } from '../gateway/otari.js';
import { StuckDetector } from './stuck-detector.js';
import { isRunDue, computeNextRun, computeBackoffUntil } from './scheduler.js';
import { Logger } from '../utils/logger.js';
import { withLock } from '../utils/lock.js';

export interface DaemonManagerOptions {
  config: AppConfig;
  store: FleetStore;
  registry?: AdapterRegistry;
  logger?: Logger;
}

export class DaemonManager {
  private config: AppConfig;
  private store: FleetStore;
  private registry: AdapterRegistry;
  private logger: Logger;
  private otari: OtariGateway;
  private stuckDetector: StuckDetector;

  constructor(opts: DaemonManagerOptions) {
    this.config = opts.config;
    this.store = opts.store;
    this.registry = opts.registry || defaultRegistry;
    this.logger = opts.logger || new Logger(
      path.join(this.config.projectsRoot, '.24x7ai', 'logs', 'daemon.log'),
      'daemon'
    );
    this.otari = new OtariGateway(this.config.otari);
    this.stuckDetector = new StuckDetector(
      this.store,
      this.config.stuckConsecutiveNoChanges,
      this.config.stuckTimeoutMs
    );
  }

  start(identifier: string | number): ProjectRecord {
    const project = this.resolveProject(identifier);
    this.store.setDaemonActive(project.id, true);
    this.logger.info(`Started daemon for ${project.slug} (sl_no: ${project.sl_no})`);
    return project;
  }

  stop(identifier: string | number): ProjectRecord {
    const project = this.resolveProject(identifier);
    this.store.setDaemonActive(project.id, false);
    this.logger.info(`Stopped daemon for ${project.slug} (sl_no: ${project.sl_no})`);
    return project;
  }

  pause(identifier: string | number): ProjectRecord {
    const project = this.resolveProject(identifier);
    this.store.updateDaemonStatus(project.id, 'paused');
    this.logger.info(`Paused daemon for ${project.slug} (sl_no: ${project.sl_no})`);
    return project;
  }

  resume(identifier: string | number): ProjectRecord {
    const project = this.resolveProject(identifier);
    this.store.updateDaemonStatus(project.id, 'idle');
    this.logger.info(`Resumed daemon for ${project.slug} (sl_no: ${project.sl_no})`);
    return project;
  }

  async supervise(): Promise<{ executed: number; skipped: number; errors: number }> {
    this.logger.info('Starting fleet supervision pass...');
    const allProjects = this.store.listProjects();
    const activeDaemons = allProjects.filter((p) => p.daemon_active && p.daemon_status !== 'paused');

    if (activeDaemons.length === 0) {
      this.logger.info('No active daemons in fleet.');
      return { executed: 0, skipped: 0, errors: 0 };
    }

    const dueProjects: ProjectRecord[] = [];

    for (const p of activeDaemons) {
      // 1. Check stuck state
      const isStuck = this.stuckDetector.evaluateAndApply(p.id);
      if (isStuck) {
        this.logger.warn(`Project ${p.slug} is STUCK. Skipping until manually resumed.`);
        continue;
      }

      // 2. Check schedule & backoff
      const daemonState = this.store.getDaemonState(p.id);
      const due = isRunDue(daemonState?.next_run_at, daemonState?.backoff_until);

      if (due) {
        dueProjects.push(p);
      }
    }

    const maxParallel = this.config.maxParallel || 4;
    const batch = dueProjects.slice(0, maxParallel);
    this.logger.info(`Supervising ${dueProjects.length} due daemons (running batch of ${batch.length}, max parallel: ${maxParallel})`);

    let executed = 0;
    let errors = 0;

    await Promise.all(
      batch.map(async (project) => {
        try {
          const success = await this.runSingleDaemon(project);
          if (success) executed++;
          else errors++;
        } catch (err: any) {
          errors++;
          this.logger.error(`Error in daemon for ${project.slug}: ${err.message}`);
        }
      })
    );

    return {
      executed,
      skipped: dueProjects.length - batch.length,
      errors,
    };
  }

  async runSingleDaemon(project: ProjectRecord): Promise<boolean> {
    const projectDir = path.join(this.config.projectsRoot, project.slug);
    const lockDir = path.join(this.config.projectsRoot, '.24x7ai', 'locks');
    fs.mkdirSync(lockDir, { recursive: true });
    const lockFile = path.join(lockDir, `${project.slug}.lock`);

    const result = await withLock(lockFile, async () => {
      return this.executeDaemonCycle(project, projectDir);
    });

    if (!result.acquired) {
      this.logger.warn(`Daemon lock already held for ${project.slug}. Skipping this cycle.`);
      return false;
    }

    return result.result ?? false;
  }

  private async executeDaemonCycle(project: ProjectRecord, projectDir: string): Promise<boolean> {
    this.logger.info(`Daemon waking up for ${project.slug}...`);

    await ensureGitRepo(projectDir);
    await ensureDevBranch(projectDir);

    // Ingest GitHub issues if any
    let issuePrompt = '';
    const issues = await fetchProjectIssues(projectDir, this.config.github.issueFilterLabel);
    if (issues.length > 0) {
      const topIssue = issues[0];
      this.logger.info(`Found open GitHub issue #${topIssue.number}: "${topIssue.title}" for ${project.slug}`);
      issuePrompt = ` Focus on addressing GitHub issue #${topIssue.number}: "${topIssue.title}". Issue description: ${topIssue.body || 'No description provided.'}`;
    }

    const prompt = [
      `Read AGENTS.md, AUTODEVELOP.md, .project-source.json and .agent-status.json.`,
      `Inspect this repository and implement one useful, coherent improvement toward its ongoing development.`,
      issuePrompt,
      `Make actual code changes, update tests and README, and update .agent-status.json.`,
      `Stay on dev. Do not claim external work or tests that were not performed.`,
      `Do not run git push or modify main.`,
    ].join(' ');

    const adapterName = this.config.defaultAdapter || 'opencode';
    const adapter = this.registry.get(adapterName);

    const runRecord = this.store.startAgentRun({
      project_id: project.id,
      adapter: adapter.name,
      prompt,
      run_type: 'daemon',
    });

    const gatewayEnv = this.otari.getAdapterEnv(project.id, 'daemon');

    const agentResult = await adapter.invoke({
      projectDir,
      prompt,
      timeout: this.config.stuckTimeoutMs,
      args: this.config.adapterArgs,
      commandOverride: this.config.adapterCommand,
      env: gatewayEnv,
      onStdout: (c) => this.logger.debug(`[${project.slug}] ${c.trim()}`),
      onStderr: (c) => this.logger.warn(`[${project.slug}] ${c.trim()}`),
    });

    const finishedRun = this.store.finishAgentRun(runRecord.id, {
      exit_code: agentResult.exitCode,
      duration_ms: agentResult.duration,
      commits_produced: agentResult.commits.length,
      files_changed: agentResult.filesChanged.length,
      error: agentResult.error,
    });

    const isSuccess = agentResult.exitCode === 0;

    // Commit any new changes
    let committedSha: string | null = null;
    if (isSuccess) {
      committedSha = await commitWorkingTree(
        projectDir,
        `chore: daemon improvement for ${project.slug}`
      );
    }

    // Schedule next run
    if (isSuccess) {
      const nextRun = computeNextRun(project.daemon_schedule);
      this.store.updateDaemonStatus(project.id, 'idle', {
        nextRunAt: nextRun.toISOString(),
      });
      this.logger.info(`Daemon cycle succeeded for ${project.slug}. Next run at ${nextRun.toLocaleTimeString()}.`);

      // Push to origin if GitHub configured
      if (this.config.github.owner && (agentResult.commits.length > 0 || committedSha)) {
        await syncGitHubRepo(projectDir, project.slug, this.config.github, this.logger);

        // Optionally create PR
        if (this.config.github.autoPr) {
          await createPullRequest(projectDir, {
            title: `Continuous Improvement for ${project.slug}`,
            body: `Automated improvement generated by 24x7ai daemon.\n\n${issuePrompt || 'General ongoing enhancement and test coverage.'}`,
          });
        }
      }
    } else {
      const daemonState = this.store.getDaemonState(project.id);
      const backoff = computeBackoffUntil(daemonState?.consecutive_errors || 1);
      this.store.updateDaemonStatus(project.id, 'error', {
        backoffUntil: backoff,
      });
      this.logger.warn(`Daemon cycle failed for ${project.slug}. Backing off until ${new Date(backoff).toLocaleTimeString()}.`);
    }

    return isSuccess;
  }

  private resolveProject(identifier: string | number): ProjectRecord {
    let project: ProjectRecord | null = null;
    if (typeof identifier === 'number' || /^\d+$/.test(String(identifier))) {
      project = this.store.getProjectById(Number(identifier)) || this.store.getProjectBySlNo(Number(identifier));
    } else {
      project = this.store.getProjectBySlug(String(identifier));
    }
    if (!project) {
      throw new Error(`Project not found: ${identifier}`);
    }
    return project;
  }
}
