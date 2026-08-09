import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applyWorkspaceCommand,
  isWorkspaceState,
  type WorkspaceCommand,
  type WorkspaceState,
} from "@synaius/domain";
import type {
  DurableWorkspaceEvent,
  WorkspaceControlCommandResult,
  WorkspaceControlCursor,
  WorkspaceControlSnapshot,
} from "../index.ts";

export class WorkspaceControlStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        command_id TEXT NOT NULL,
        command_json TEXT NOT NULL,
        state_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE(workspace_id, revision),
        UNIQUE(workspace_id, command_id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_events_workspace_cursor
        ON workspace_events(workspace_id, id);
    `);
  }

  close() {
    this.database.close();
  }

  initialize(workspace: WorkspaceState): WorkspaceControlSnapshot {
    if (!isWorkspaceState(workspace)) throw statusError("workspace-control.workspace.invalid", 400);
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO workspaces (workspace_id, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(workspace_id) DO NOTHING
    `).run(workspace.id, JSON.stringify(workspace), now);
    return this.read(workspace.id);
  }

  read(workspaceId: string): WorkspaceControlSnapshot {
    const row = this.database.prepare(
      "SELECT state_json FROM workspaces WHERE workspace_id = ?",
    ).get(workspaceId) as { state_json: string } | undefined;
    if (!row) throw statusError("workspace-control.workspace.notFound", 404);
    return {
      workspace: parseWorkspace(row.state_json),
      latestCursor: this.latestCursor(workspaceId),
    };
  }

  execute(workspaceId: string, command: WorkspaceCommand) {
    assertCommandEnvelope(command);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const duplicate = this.database.prepare(`
        SELECT * FROM workspace_events
        WHERE workspace_id = ? AND command_id = ?
      `).get(workspaceId, command.id) as WorkspaceEventRow | undefined;
      if (duplicate) {
        if (duplicate.command_json !== JSON.stringify(command)) {
          throw statusError("workspace-control.command.idConflict", 409);
        }
        const current = this.read(workspaceId);
        const result = commandResult(duplicate, current);
        this.database.exec("COMMIT");
        return { ...result, duplicate: true };
      }

      const current = this.read(workspaceId).workspace;
      let applied;
      try {
        applied = applyWorkspaceCommand(current, command);
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error);
        throw statusError(code, code === "workspace.revision.conflict" ? 409 : 400);
      }
      if (!isWorkspaceState(applied.state)) throw statusError("workspace-control.result.invalid", 500);
      const occurredAt = new Date().toISOString();
      const inserted = this.database.prepare(`
        INSERT INTO workspace_events
          (workspace_id, revision, command_id, command_json, state_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        workspaceId,
        applied.state.revision,
        command.id,
        JSON.stringify(command),
        JSON.stringify(applied.state),
        occurredAt,
      );
      this.database.prepare(`
        UPDATE workspaces SET state_json = ?, updated_at = ? WHERE workspace_id = ?
      `).run(JSON.stringify(applied.state), occurredAt, workspaceId);
      const event: DurableWorkspaceEvent = {
        cursor: String(inserted.lastInsertRowid),
        workspaceId,
        revision: applied.state.revision,
        command: structuredClone(command),
        occurredAt,
      };
      this.database.exec("COMMIT");
      return {
        workspace: applied.state,
        latestCursor: event.cursor,
        event,
        duplicate: false,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  eventsAfter(
    workspaceId: string,
    after: WorkspaceControlCursor | null = null,
    limit = 500,
    through: WorkspaceControlCursor | null = null,
  ): DurableWorkspaceEvent[] {
    const afterId = cursorNumber(after);
    const throughId = through ? cursorNumber(through) : Number.MAX_SAFE_INTEGER;
    const safeLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
    return (this.database.prepare(`
      SELECT * FROM workspace_events
      WHERE workspace_id = ? AND id > ? AND id <= ?
      ORDER BY id ASC LIMIT ?
    `).all(workspaceId, afterId, throughId, safeLimit) as unknown as WorkspaceEventRow[])
      .map(mapEvent);
  }

  latestCursor(workspaceId: string): WorkspaceControlCursor | null {
    const row = this.database.prepare(
      "SELECT MAX(id) AS id FROM workspace_events WHERE workspace_id = ?",
    ).get(workspaceId) as { id: number | null } | undefined;
    return row?.id ? String(row.id) : null;
  }
}

interface WorkspaceEventRow {
  id: number;
  workspace_id: string;
  revision: number;
  command_id: string;
  command_json: string;
  state_json: string;
  occurred_at: string;
}

function mapEvent(row: WorkspaceEventRow): DurableWorkspaceEvent {
  return {
    cursor: String(row.id),
    workspaceId: row.workspace_id,
    revision: row.revision,
    command: JSON.parse(row.command_json) as WorkspaceCommand,
    occurredAt: row.occurred_at,
  };
}

function commandResult(
  row: WorkspaceEventRow,
  current: WorkspaceControlSnapshot,
): WorkspaceControlCommandResult {
  return {
    workspace: current.workspace,
    latestCursor: current.latestCursor,
    event: mapEvent(row),
  };
}

function parseWorkspace(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!isWorkspaceState(parsed)) throw statusError("workspace-control.store.corrupt", 500);
  return parsed;
}

function cursorNumber(cursor: WorkspaceControlCursor | null) {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw statusError("workspace-control.cursor.invalid", 400);
  }
  return value;
}

function statusError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function assertCommandEnvelope(command: WorkspaceCommand) {
  const candidate = command as unknown as Record<string, unknown> | null;
  if (!candidate
    || typeof candidate.id !== "string"
    || !candidate.id.trim()
    || typeof candidate.type !== "string"
    || !Number.isSafeInteger(candidate.expectedRevision)
    || (candidate.expectedRevision as number) < 0
    || typeof candidate.payload !== "object"
    || candidate.payload === null
    || Array.isArray(candidate.payload)) {
    throw statusError("workspace-control.command.invalid", 400);
  }
}
