import Database from 'better-sqlite3';
import { ProjectRecord, AgentRunRecord, DaemonStateRecord, ProjectWithDaemon, DaemonStatus, RunType } from './models.js';

export class FleetStore {
  constructor(private db: Database.Database) {}

  // Projects
  upsertProject(project: {
    slug: string;
    idea: string;
    sl_no: number;
    source_csv?: string;
    mvp_complete?: boolean;
    daemon_active?: boolean;
    daemon_schedule?: string;
  }): ProjectRecord {
    const stmt = this.db.prepare(`
      INSERT INTO projects (slug, idea, sl_no, source_csv, mvp_complete, daemon_active, daemon_schedule, updated_at)
      VALUES (@slug, @idea, @sl_no, @source_csv, @mvp_complete, @daemon_active, @daemon_schedule, datetime('now'))
      ON CONFLICT(slug) DO UPDATE SET
        idea = excluded.idea,
        sl_no = excluded.sl_no,
        source_csv = COALESCE(excluded.source_csv, projects.source_csv),
        updated_at = datetime('now')
      RETURNING *
    `);

    const row = stmt.get({
      slug: project.slug,
      idea: project.idea,
      sl_no: project.sl_no,
      source_csv: project.source_csv || null,
      mvp_complete: project.mvp_complete ? 1 : 0,
      daemon_active: project.daemon_active ? 1 : 0,
      daemon_schedule: project.daemon_schedule || '*/30 * * * *',
    }) as any;

    // Ensure daemon_state row exists
    this.db.prepare(`
      INSERT OR IGNORE INTO daemon_state (project_id, status, updated_at)
      VALUES (?, 'idle', datetime('now'))
    `).run(row.id);

    return this.mapProject(row);
  }

  getProjectBySlug(slug: string): ProjectRecord | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as any;
    return row ? this.mapProject(row) : null;
  }

  getProjectById(id: number): ProjectRecord | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    return row ? this.mapProject(row) : null;
  }

  deleteProject(id: number): boolean {
    const res = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return res.changes > 0;
  }

  searchProjects(keyword: string): ProjectWithDaemon[] {
    const pattern = `%${keyword}%`;
    const rows = this.db.prepare(`
      SELECT 
        p.*,
        d.status as daemon_status,
        d.next_run_at,
        d.consecutive_errors,
        r.started_at as last_run_started_at,
        r.duration_ms as last_run_duration_ms,
        r.commits_produced as last_run_commits
      FROM projects p
      LEFT JOIN daemon_state d ON d.project_id = p.id
      LEFT JOIN agent_runs r ON r.id = d.last_run_id
      WHERE p.slug LIKE ? OR p.idea LIKE ?
      ORDER BY p.sl_no ASC
    `).all(pattern, pattern) as any[];

    return rows.map(r => ({
      ...this.mapProject(r),
      daemon_status: r.daemon_status || 'idle',
      next_run_at: r.next_run_at || undefined,
      consecutive_errors: r.consecutive_errors || 0,
      last_run_started_at: r.last_run_started_at || undefined,
      last_run_duration_ms: r.last_run_duration_ms || undefined,
      last_run_commits: r.last_run_commits || 0,
    }));
  }

  getProjectBySlNo(slNo: number): ProjectRecord | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE sl_no = ?').get(slNo) as any;
    return row ? this.mapProject(row) : null;
  }

  setMvpComplete(projectId: number, complete: boolean = true): void {
    this.db.prepare(`
      UPDATE projects
      SET mvp_complete = ?, daemon_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(complete ? 1 : 0, complete ? 1 : 0, projectId);

    if (complete) {
      this.db.prepare(`
        UPDATE daemon_state
        SET status = 'idle', updated_at = datetime('now')
        WHERE project_id = ? AND status = 'paused'
      `).run(projectId);
    }
  }

  setDaemonActive(projectId: number, active: boolean): void {
    this.db.prepare(`
      UPDATE projects
      SET daemon_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(active ? 1 : 0, projectId);

    const newStatus: DaemonStatus = active ? 'idle' : 'paused';
    this.db.prepare(`
      UPDATE daemon_state
      SET status = ?, updated_at = datetime('now')
      WHERE project_id = ?
    `).run(newStatus, projectId);
  }

  listProjects(): ProjectWithDaemon[] {
    const rows = this.db.prepare(`
      SELECT 
        p.*,
        d.status as daemon_status,
        d.next_run_at,
        d.consecutive_errors,
        r.started_at as last_run_started_at,
        r.duration_ms as last_run_duration_ms,
        r.commits_produced as last_run_commits
      FROM projects p
      LEFT JOIN daemon_state d ON d.project_id = p.id
      LEFT JOIN agent_runs r ON r.id = d.last_run_id
      ORDER BY p.sl_no ASC
    `).all() as any[];

    return rows.map(r => ({
      ...this.mapProject(r),
      daemon_status: r.daemon_status || 'idle',
      next_run_at: r.next_run_at || undefined,
      consecutive_errors: r.consecutive_errors || 0,
      last_run_started_at: r.last_run_started_at || undefined,
      last_run_duration_ms: r.last_run_duration_ms || undefined,
      last_run_commits: r.last_run_commits || 0,
    }));
  }

  // Agent Runs
  startAgentRun(opts: {
    project_id: number;
    adapter: string;
    prompt?: string;
    run_type: RunType;
  }): AgentRunRecord {
    const stmt = this.db.prepare(`
      INSERT INTO agent_runs (project_id, adapter, prompt, run_type, started_at)
      VALUES (@project_id, @adapter, @prompt, @run_type, datetime('now'))
      RETURNING *
    `);

    const row = stmt.get({
      project_id: opts.project_id,
      adapter: opts.adapter,
      prompt: opts.prompt || null,
      run_type: opts.run_type,
    }) as any;

    // Update daemon state
    this.db.prepare(`
      UPDATE daemon_state
      SET status = 'running', last_run_id = ?, updated_at = datetime('now')
      WHERE project_id = ?
    `).run(row.id, opts.project_id);

    return this.mapRun(row);
  }

  finishAgentRun(runId: number, opts: {
    exit_code: number;
    duration_ms: number;
    commits_produced: number;
    files_changed: number;
    error?: string;
  }): AgentRunRecord {
    const stmt = this.db.prepare(`
      UPDATE agent_runs
      SET exit_code = @exit_code,
          duration_ms = @duration_ms,
          commits_produced = @commits_produced,
          files_changed = @files_changed,
          error = @error,
          finished_at = datetime('now')
      WHERE id = @run_id
      RETURNING *
    `);

    const row = stmt.get({
      run_id: runId,
      exit_code: opts.exit_code,
      duration_ms: opts.duration_ms,
      commits_produced: opts.commits_produced,
      files_changed: opts.files_changed,
      error: opts.error || null,
    }) as any;

    if (!row) throw new Error(`Agent run ${runId} not found`);

    // Update daemon state error counter / status
    const isError = opts.exit_code !== 0;
    const noChanges = opts.commits_produced === 0 && opts.files_changed === 0;

    this.db.prepare(`
      UPDATE daemon_state
      SET status = CASE WHEN ? = 1 THEN 'error' ELSE 'idle' END,
          consecutive_errors = CASE WHEN ? = 1 THEN consecutive_errors + 1 ELSE 0 END,
          consecutive_no_changes = CASE WHEN ? = 1 THEN consecutive_no_changes + 1 ELSE 0 END,
          updated_at = datetime('now')
      WHERE project_id = ?
    `).run(
      isError ? 1 : 0,
      isError ? 1 : 0,
      noChanges ? 1 : 0,
      row.project_id
    );

    return this.mapRun(row);
  }

  getRecentRuns(projectId: number, limit = 10): AgentRunRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_runs
      WHERE project_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(projectId, limit) as any[];

    return rows.map(r => this.mapRun(r));
  }

  // Daemon state management
  updateDaemonStatus(projectId: number, status: DaemonStatus, extra?: {
    nextRunAt?: string;
    backoffUntil?: string;
  }): void {
    this.db.prepare(`
      UPDATE daemon_state
      SET status = @status,
          next_run_at = COALESCE(@next_run_at, next_run_at),
          backoff_until = COALESCE(@backoff_until, backoff_until),
          updated_at = datetime('now')
      WHERE project_id = @project_id
    `).run({
      project_id: projectId,
      status,
      next_run_at: extra?.nextRunAt || null,
      backoff_until: extra?.backoffUntil || null,
    });
  }

  getDaemonState(projectId: number): DaemonStateRecord | null {
    const row = this.db.prepare('SELECT * FROM daemon_state WHERE project_id = ?').get(projectId) as any;
    if (!row) return null;
    return {
      project_id: row.project_id,
      status: row.status,
      last_run_id: row.last_run_id || undefined,
      next_run_at: row.next_run_at || undefined,
      consecutive_errors: row.consecutive_errors || 0,
      consecutive_no_changes: row.consecutive_no_changes || 0,
      backoff_until: row.backoff_until || undefined,
      updated_at: row.updated_at,
    };
  }

  getFleetStats(): {
    totalRuns: number;
    totalCommits: number;
    totalFilesChanged: number;
    avgDurationMs: number;
  } {
    const row = this.db.prepare(`
      SELECT
        COUNT(id) as total_runs,
        SUM(commits_produced) as total_commits,
        SUM(files_changed) as total_files,
        AVG(duration_ms) as avg_duration
      FROM agent_runs
    `).get() as any;

    return {
      totalRuns: row?.total_runs || 0,
      totalCommits: row?.total_commits || 0,
      totalFilesChanged: row?.total_files || 0,
      avgDurationMs: Math.round(row?.avg_duration || 0),
    };
  }

  getFleetSummary(): {
    totalProjects: number;
    mvpCompleted: number;
    activeDaemons: number;
    runningCount: number;
    stuckCount: number;
    errorCount: number;
  } {
    const res = this.db.prepare(`
      SELECT
        COUNT(p.id) as total,
        SUM(p.mvp_complete) as mvp_done,
        SUM(p.daemon_active) as active_daemons,
        SUM(CASE WHEN d.status = 'running' THEN 1 ELSE 0 END) as running_count,
        SUM(CASE WHEN d.status = 'stuck' THEN 1 ELSE 0 END) as stuck_count,
        SUM(CASE WHEN d.status = 'error' THEN 1 ELSE 0 END) as error_count
      FROM projects p
      LEFT JOIN daemon_state d ON d.project_id = p.id
    `).get() as any;

    return {
      totalProjects: res.total || 0,
      mvpCompleted: res.mvp_done || 0,
      activeDaemons: res.active_daemons || 0,
      runningCount: res.running_count || 0,
      stuckCount: res.stuck_count || 0,
      errorCount: res.error_count || 0,
    };
  }

  // Helper mappings
  private mapProject(row: any): ProjectRecord {
    return {
      id: row.id,
      slug: row.slug,
      idea: row.idea,
      sl_no: row.sl_no,
      source_csv: row.source_csv || undefined,
      mvp_complete: Boolean(row.mvp_complete),
      daemon_active: Boolean(row.daemon_active),
      daemon_schedule: row.daemon_schedule || '*/30 * * * *',
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapRun(row: any): AgentRunRecord {
    return {
      id: row.id,
      project_id: row.project_id,
      adapter: row.adapter,
      prompt: row.prompt || undefined,
      exit_code: row.exit_code != null ? row.exit_code : undefined,
      duration_ms: row.duration_ms != null ? row.duration_ms : undefined,
      commits_produced: row.commits_produced || 0,
      files_changed: row.files_changed || 0,
      error: row.error || undefined,
      run_type: row.run_type,
      started_at: row.started_at,
      finished_at: row.finished_at || undefined,
    };
  }
}
