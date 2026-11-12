import Database from 'better-sqlite3';
import type { AgentDefinition, AgentRun, RunStatus } from './types.js';

interface RunRow {
  id: string;
  agent_id: string;
  role: AgentRun['role'];
  model: string;
  correlation_id: string;
  status: RunStatus;
  task_json: string;
  attempt: number;
  max_retries: number;
  timeout_ms: number;
  error_json: string | null;
  result_json: string | null;
  metadata_json: string;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class AgentRuntimeStore {
  constructor(private readonly db: Database.Database) {}

  upsertAgent(agent: AgentDefinition): void {
    this.db.prepare(`
      INSERT INTO agent_definitions (
        id, role, model, provider_model, system_instructions, timeout_ms, updated_at
      ) VALUES (
        @id, @role, @model, @providerModel, @systemInstructions, @timeoutMs, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        role = excluded.role,
        model = excluded.model,
        provider_model = excluded.provider_model,
        system_instructions = excluded.system_instructions,
        timeout_ms = excluded.timeout_ms,
        updated_at = datetime('now')
    `).run({ ...agent });
  }

  getAgent(id: string): AgentDefinition | null {
    const row = this.db.prepare('SELECT * FROM agent_definitions WHERE id = ?').get(id) as any;
    return row ? this.mapAgent(row) : null;
  }

  listAgents(): AgentDefinition[] {
    const rows = this.db.prepare('SELECT * FROM agent_definitions ORDER BY role, id').all() as any[];
    return rows.map((row) => this.mapAgent(row));
  }

  createRun(run: AgentRun): void {
    this.db.prepare(`
      INSERT INTO agent_task_runs (
        id, agent_id, role, model, correlation_id, status, task_json, attempt,
        max_retries, timeout_ms, error_json, result_json, metadata_json,
        created_at, queued_at, started_at, finished_at, updated_at
      ) VALUES (
        @id, @agentId, @role, @model, @correlationId, @status, @taskJson, @attempt,
        @maxRetries, @timeoutMs, @errorJson, @resultJson, @metadataJson,
        @createdAt, @queuedAt, @startedAt, @finishedAt, @updatedAt
      )
    `).run(this.serializeRun(run));
  }

  updateRun(run: AgentRun): void {
    const result = this.db.prepare(`
      UPDATE agent_task_runs SET
        status = @status,
        attempt = @attempt,
        error_json = @errorJson,
        result_json = @resultJson,
        metadata_json = @metadataJson,
        queued_at = @queuedAt,
        started_at = @startedAt,
        finished_at = @finishedAt,
        updated_at = @updatedAt
      WHERE id = @id
    `).run(this.serializeRun(run));
    if (result.changes === 0) throw new Error(`Agent task run "${run.id}" not found`);
  }

  getRun(id: string): AgentRun | null {
    const row = this.db.prepare('SELECT * FROM agent_task_runs WHERE id = ?').get(id) as RunRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  listRuns(options: { limit?: number; status?: RunStatus } = {}): AgentRun[] {
    const limit = options.limit ?? 100;
    const rows = options.status
      ? this.db.prepare('SELECT * FROM agent_task_runs WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(options.status, limit)
      : this.db.prepare('SELECT * FROM agent_task_runs ORDER BY created_at DESC, id DESC LIMIT ?').all(limit);
    return (rows as RunRow[]).map((row) => this.mapRun(row));
  }

  private serializeRun(run: AgentRun): Record<string, unknown> {
    return {
      ...run,
      taskJson: JSON.stringify(run.task),
      errorJson: run.error ? JSON.stringify(run.error) : null,
      resultJson: run.result ? JSON.stringify(run.result) : null,
      metadataJson: JSON.stringify(run.metadata),
      queuedAt: run.queuedAt ?? null,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
    };
  }

  private mapAgent(row: any): AgentDefinition {
    return {
      id: row.id,
      role: row.role,
      model: row.model,
      providerModel: row.provider_model,
      systemInstructions: row.system_instructions,
      timeoutMs: row.timeout_ms,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRun(row: RunRow): AgentRun {
    return {
      id: row.id,
      agentId: row.agent_id,
      role: row.role,
      model: row.model,
      correlationId: row.correlation_id,
      status: row.status,
      task: parseJson(row.task_json, { prompt: '' }),
      attempt: row.attempt,
      maxRetries: row.max_retries,
      timeoutMs: row.timeout_ms,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.queued_at ? { queuedAt: row.queued_at } : {}),
      ...(row.started_at ? { startedAt: row.started_at } : {}),
      ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
      ...(row.error_json ? { error: parseJson(row.error_json, undefined) } : {}),
      ...(row.result_json ? { result: parseJson(row.result_json, undefined) } : {}),
      metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    };
  }
}
