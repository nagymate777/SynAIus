import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AppServerNotification,
  DurableThreadEvent,
  StreamCursor,
  ThreadRuntimeStatus,
  ThreadSnapshot,
} from "@synaius/protocol";

export interface AppendThreadEventInput {
  threadId: string;
  turnId: string | null;
  method: string;
  source: DurableThreadEvent["source"];
  connectionId: string;
  raw: AppServerNotification;
  receivedAt?: string;
}

export class ThreadEventStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS thread_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        method TEXT NOT NULL,
        source TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_thread_events_thread_cursor
        ON thread_events(thread_id, id);
      CREATE TABLE IF NOT EXISTS thread_snapshots (
        thread_id TEXT PRIMARY KEY,
        active_turn_id TEXT,
        name TEXT,
        status TEXT NOT NULL,
        access_mode TEXT NOT NULL DEFAULT 'interactive',
        raw_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thread_subscriptions (
        thread_id TEXT PRIMARY KEY,
        attached_at TEXT NOT NULL,
        last_resumed_at TEXT
      );
    `);
    const snapshotColumns = this.database.prepare("PRAGMA table_info(thread_snapshots)")
      .all() as Array<{ name: string }>;
    if (!snapshotColumns.some((column) => column.name === "access_mode")) {
      this.database.exec("ALTER TABLE thread_snapshots ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'interactive'");
    }
  }

  close() {
    this.database.close();
  }

  appendEvent(input: AppendThreadEventInput): DurableThreadEvent {
    const receivedAt = input.receivedAt ?? new Date().toISOString();
    const result = this.database.prepare(`
      INSERT INTO thread_events
        (thread_id, turn_id, method, source, connection_id, raw_json, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.threadId,
      input.turnId,
      input.method,
      input.source,
      input.connectionId,
      JSON.stringify(input.raw),
      receivedAt,
    );
    return {
      cursor: String(result.lastInsertRowid),
      threadId: input.threadId,
      turnId: input.turnId,
      method: input.method,
      source: input.source,
      connectionId: input.connectionId,
      receivedAt,
      raw: structuredClone(input.raw),
    };
  }

  eventsAfter(
    threadId: string,
    after: StreamCursor | null = null,
    limit = 500,
    through: StreamCursor | null = null,
  ): DurableThreadEvent[] {
    const afterId = cursorNumber(after);
    const throughId = through ? cursorNumber(through) : Number.MAX_SAFE_INTEGER;
    const safeLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
    return this.database.prepare(`
      SELECT * FROM thread_events
      WHERE thread_id = ? AND id > ? AND id <= ?
      ORDER BY id ASC LIMIT ?
    `).all(threadId, afterId, throughId, safeLimit).map(mapEvent);
  }

  latestCursor(threadId: string): StreamCursor | null {
    const row = this.database.prepare(
      "SELECT MAX(id) AS id FROM thread_events WHERE thread_id = ?",
    ).get(threadId) as { id: number | null } | undefined;
    return row?.id ? String(row.id) : null;
  }

  saveSnapshot(snapshot: ThreadSnapshot) {
    const updatedAt = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO thread_snapshots
        (thread_id, active_turn_id, name, status, access_mode, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        active_turn_id = excluded.active_turn_id,
        name = excluded.name,
        status = excluded.status,
        access_mode = excluded.access_mode,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `).run(
      snapshot.threadId,
      snapshot.activeTurnId,
      snapshot.name,
      snapshot.status,
      snapshot.accessMode,
      JSON.stringify(snapshot.raw),
      updatedAt,
    );
  }

  readSnapshot(threadId: string): ThreadSnapshot | null {
    const row = this.database.prepare(
      "SELECT * FROM thread_snapshots WHERE thread_id = ?",
    ).get(threadId) as SnapshotRow | undefined;
    return row ? {
      threadId: row.thread_id,
      cursor: this.latestCursor(row.thread_id),
      activeTurnId: row.active_turn_id,
      name: row.name,
      status: normalizeRuntimeStatus(row.status),
      accessMode: row.access_mode === "observe" ? "observe" : "interactive",
      raw: JSON.parse(row.raw_json),
    } : null;
  }

  attachThread(threadId: string) {
    this.database.prepare(`
      INSERT INTO thread_subscriptions (thread_id, attached_at, last_resumed_at)
      VALUES (?, ?, NULL)
      ON CONFLICT(thread_id) DO NOTHING
    `).run(threadId, new Date().toISOString());
  }

  markResumed(threadId: string) {
    this.attachThread(threadId);
    this.database.prepare(
      "UPDATE thread_subscriptions SET last_resumed_at = ? WHERE thread_id = ?",
    ).run(new Date().toISOString(), threadId);
  }

  attachedThreadIds(): string[] {
    return (this.database.prepare(
      "SELECT thread_id FROM thread_subscriptions ORDER BY attached_at ASC",
    ).all() as Array<{ thread_id: string }>).map((row) => row.thread_id);
  }
}

interface EventRow {
  id: number;
  thread_id: string;
  turn_id: string | null;
  method: string;
  source: DurableThreadEvent["source"];
  connection_id: string;
  raw_json: string;
  received_at: string;
}

interface SnapshotRow {
  thread_id: string;
  active_turn_id: string | null;
  name: string | null;
  status: string;
  access_mode: string;
  raw_json: string;
}

function mapEvent(row: unknown): DurableThreadEvent {
  const event = row as EventRow;
  return {
    cursor: String(event.id),
    threadId: event.thread_id,
    turnId: event.turn_id,
    method: event.method,
    source: event.source,
    connectionId: event.connection_id,
    receivedAt: event.received_at,
    raw: JSON.parse(event.raw_json) as AppServerNotification,
  };
}

function cursorNumber(cursor: StreamCursor | null) {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("thread-stream.cursor.invalid");
  return value;
}

function normalizeRuntimeStatus(status: string): ThreadRuntimeStatus {
  return ["notLoaded", "idle", "active", "systemError"].includes(status)
    ? status as ThreadRuntimeStatus
    : "unknown";
}
