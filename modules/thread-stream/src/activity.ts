import type { DurableThreadEvent, ThreadSnapshot } from "@synaius/protocol";

const MAX_ACTIVITY_TEXT = 200_000;
const MAX_JSON_PREVIEW = 50_000;
const MAX_PROGRESS_MESSAGES = 50;

export type ThreadActivityStatus =
  | "inProgress"
  | "completed"
  | "failed"
  | "declined"
  | "interrupted"
  | "unknown";

interface ThreadActivityBase {
  id: string;
  turnId: string | null;
  status: ThreadActivityStatus;
}

export interface ThreadFileChange {
  path: string;
  kind: "add" | "update" | "delete" | "unknown";
  diff: string;
}

export type ThreadActivity = ThreadActivityBase & (
  | {
      kind: "command";
      command: string;
      cwd: string;
      output: string;
      exitCode: number | null;
      durationMs: number | null;
    }
  | {
      kind: "fileChange";
      changes: ThreadFileChange[];
    }
  | {
      kind: "turnDiff";
      diff: string;
    }
  | {
      kind: "mcpTool";
      server: string;
      tool: string;
      argumentsPreview: string | null;
      resultPreview: string | null;
      error: string | null;
      progress: string[];
      durationMs: number | null;
    }
  | {
      kind: "dynamicTool";
      namespace: string | null;
      tool: string;
      argumentsPreview: string | null;
      resultPreview: string | null;
      success: boolean | null;
      durationMs: number | null;
    }
);

export type ThreadStreamLine =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "agent"; text: string }
  | { id: string; kind: "activity"; activity: ThreadActivity };

export function projectThreadSnapshot(snapshot: ThreadSnapshot): ThreadStreamLine[] {
  const thread = asRecord(snapshot.raw);
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  return turns.flatMap((turn) => {
    const turnRecord = asRecord(turn);
    const turnId = stringValue(turnRecord.id);
    const items = Array.isArray(turnRecord.items) ? turnRecord.items : [];
    return items.flatMap((item) => lineFromItem(asRecord(item), turnId));
  });
}

export function projectThreadEvent(
  current: ThreadStreamLine[],
  event: DurableThreadEvent,
): ThreadStreamLine[] {
  const params = asRecord(event.raw.params);
  if (event.method === "item/agentMessage/delta") {
    const itemId = stringValue(params.itemId) ?? `cursor:${event.cursor}`;
    const delta = stringValue(params.delta) ?? "";
    const existing = current.find((line): line is Extract<ThreadStreamLine, { kind: "agent" }> => (
      line.id === itemId && line.kind === "agent"
    ));
    if (!existing) return [...current, { id: itemId, kind: "agent", text: delta }];
    return current.map((line) => line === existing
      ? { ...line, text: boundedText(`${line.text}${delta}`) }
      : line);
  }

  if (event.method === "item/started" || event.method === "item/completed") {
    return lineFromItem(asRecord(params.item), event.turnId)
      .reduce(upsertLine, current);
  }

  if (event.method === "item/commandExecution/outputDelta") {
    const itemId = stringValue(params.itemId) ?? `cursor:${event.cursor}`;
    const delta = stringValue(params.delta) ?? "";
    return updateActivity(current, itemId, (activity) => activity.kind === "command"
      ? { ...activity, output: boundedText(`${activity.output}${delta}`) }
      : activity, {
      id: itemId,
      turnId: event.turnId,
      kind: "command",
      status: "inProgress",
      command: "",
      cwd: "",
      output: boundedText(delta),
      exitCode: null,
      durationMs: null,
    });
  }

  if (event.method === "item/fileChange/patchUpdated") {
    const itemId = stringValue(params.itemId) ?? `cursor:${event.cursor}`;
    const changes = fileChanges(params.changes);
    return updateActivity(current, itemId, (activity) => activity.kind === "fileChange"
      ? { ...activity, changes }
      : activity, {
      id: itemId,
      turnId: event.turnId,
      kind: "fileChange",
      status: "inProgress",
      changes,
    });
  }

  if (event.method === "item/mcpToolCall/progress") {
    const itemId = stringValue(params.itemId) ?? `cursor:${event.cursor}`;
    const message = stringValue(params.message) ?? "";
    return updateActivity(current, itemId, (activity) => activity.kind === "mcpTool"
      ? {
          ...activity,
          progress: [...activity.progress, message].filter(Boolean).slice(-MAX_PROGRESS_MESSAGES),
        }
      : activity, {
      id: itemId,
      turnId: event.turnId,
      kind: "mcpTool",
      status: "inProgress",
      server: "",
      tool: "",
      argumentsPreview: null,
      resultPreview: null,
      error: null,
      progress: message ? [message] : [],
      durationMs: null,
    });
  }

  if (event.method === "turn/diff/updated") {
    const turnId = event.turnId ?? stringValue(params.turnId);
    if (!turnId) return current;
    return upsertLine(current, activityLine({
      id: `turn-diff:${turnId}`,
      turnId,
      kind: "turnDiff",
      status: "inProgress",
      diff: boundedText(stringValue(params.diff) ?? ""),
    }));
  }

  if (event.method === "turn/completed") {
    const turn = asRecord(params.turn);
    const turnId = stringValue(turn.id) ?? event.turnId;
    const items = Array.isArray(turn.items) ? turn.items : [];
    const withAuthoritativeItems = items
      .flatMap((item) => lineFromItem(asRecord(item), turnId))
      .reduce(upsertLine, current);
    const turnStatus = activityStatus(turn.status);
    return withAuthoritativeItems.map((line) => line.kind === "activity"
      && line.activity.kind === "turnDiff"
      && line.activity.turnId === turnId
      ? { ...line, activity: { ...line.activity, status: turnStatus } }
      : line);
  }

  return current;
}

function lineFromItem(item: Record<string, unknown>, turnId: string | null): ThreadStreamLine[] {
  const id = stringValue(item.id) ?? "";
  if (!id) return [];
  if (item.type === "agentMessage") {
    const text = stringValue(item.text) ?? "";
    return text ? [{ id, kind: "agent", text: boundedText(text) }] : [];
  }
  if (item.type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const text = content
      .map((part) => stringValue(asRecord(part).text))
      .filter((part): part is string => Boolean(part))
      .join("\n");
    return text ? [{ id, kind: "user", text: boundedText(text) }] : [];
  }
  if (item.type === "commandExecution") {
    return [activityLine({
      id,
      turnId,
      kind: "command",
      status: activityStatus(item.status),
      command: boundedText(stringValue(item.command) ?? ""),
      cwd: boundedText(stringValue(item.cwd) ?? ""),
      output: boundedText(stringValue(item.aggregatedOutput) ?? ""),
      exitCode: numberValue(item.exitCode),
      durationMs: numberValue(item.durationMs),
    })];
  }
  if (item.type === "fileChange") {
    return [activityLine({
      id,
      turnId,
      kind: "fileChange",
      status: activityStatus(item.status),
      changes: fileChanges(item.changes),
    })];
  }
  if (item.type === "mcpToolCall") {
    return [activityLine({
      id,
      turnId,
      kind: "mcpTool",
      status: activityStatus(item.status),
      server: boundedText(stringValue(item.server) ?? ""),
      tool: boundedText(stringValue(item.tool) ?? ""),
      argumentsPreview: previewField(item, "argumentsPreview", "arguments"),
      resultPreview: previewField(item, "resultPreview", "result"),
      error: errorMessage(item.error),
      progress: stringArray(item.progress).slice(-MAX_PROGRESS_MESSAGES),
      durationMs: numberValue(item.durationMs),
    })];
  }
  if (item.type === "dynamicToolCall") {
    return [activityLine({
      id,
      turnId,
      kind: "dynamicTool",
      status: activityStatus(item.status),
      namespace: stringValue(item.namespace),
      tool: boundedText(stringValue(item.tool) ?? ""),
      argumentsPreview: previewField(item, "argumentsPreview", "arguments"),
      resultPreview: previewField(item, "resultPreview", "contentItems"),
      success: typeof item.success === "boolean" ? item.success : null,
      durationMs: numberValue(item.durationMs),
    })];
  }
  return [];
}

function activityLine(activity: ThreadActivity): ThreadStreamLine {
  return { id: activity.id, kind: "activity", activity };
}

function upsertLine(current: ThreadStreamLine[], incoming: ThreadStreamLine) {
  const index = current.findIndex((line) => line.id === incoming.id);
  if (index < 0) return [...current, incoming];
  return current.map((line, candidateIndex) => candidateIndex === index
    ? mergeLine(line, incoming)
    : line);
}

function mergeLine(current: ThreadStreamLine, incoming: ThreadStreamLine): ThreadStreamLine {
  if (current.kind === "activity" && incoming.kind === "activity"
    && current.activity.kind === "mcpTool" && incoming.activity.kind === "mcpTool") {
    return activityLine({
      ...incoming.activity,
      progress: incoming.activity.progress.length
        ? incoming.activity.progress
        : current.activity.progress,
    });
  }
  return incoming;
}

function updateActivity(
  current: ThreadStreamLine[],
  itemId: string,
  update: (activity: ThreadActivity) => ThreadActivity,
  fallback: ThreadActivity,
) {
  const existing = current.find((line) => line.id === itemId && line.kind === "activity");
  if (!existing || existing.kind !== "activity") return [...current, activityLine(fallback)];
  return current.map((line) => line === existing
    ? activityLine(update(existing.activity))
    : line);
}

function fileChanges(value: unknown): ThreadFileChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const change = asRecord(candidate);
    const path = stringValue(change.path);
    if (!path) return [];
    const kind = ["add", "update", "delete"].includes(String(change.kind))
      ? change.kind as ThreadFileChange["kind"]
      : "unknown";
    return [{
      path: boundedText(path),
      kind,
      diff: boundedText(stringValue(change.diff) ?? ""),
    }];
  });
}

function previewField(item: Record<string, unknown>, previewKey: string, rawKey: string) {
  const provided = stringValue(item[previewKey]);
  return provided === null ? jsonPreview(item[rawKey]) : boundedText(provided, MAX_JSON_PREVIEW);
}

function jsonPreview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return boundedText(JSON.stringify(value, null, 2), MAX_JSON_PREVIEW);
  } catch {
    return boundedText(String(value), MAX_JSON_PREVIEW);
  }
}

function errorMessage(value: unknown) {
  const direct = stringValue(value);
  if (direct !== null) return boundedText(direct, MAX_JSON_PREVIEW);
  const message = stringValue(asRecord(value).message);
  return message === null ? jsonPreview(value) : boundedText(message, MAX_JSON_PREVIEW);
}

function activityStatus(value: unknown): ThreadActivityStatus {
  const status = typeof value === "string" ? value : stringValue(asRecord(value).type);
  return ["inProgress", "completed", "failed", "declined", "interrupted"].includes(status ?? "")
    ? status as ThreadActivityStatus
    : "unknown";
}

function boundedText(value: string, maximum = MAX_ACTIVITY_TEXT) {
  return value.length <= maximum ? value : value.slice(value.length - maximum);
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
