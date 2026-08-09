import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  AppServerNotification,
  CodexModelPage,
  CreateCodexThreadInput,
  ThreadPage,
  ThreadListQuery,
  ThreadRuntimeStatus,
  ThreadSnapshot,
  ThreadSummary,
} from "@synaius/protocol";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_EXECUTABLE = join(homedir(), ".codex", "plugins", ".plugin-appserver", "codex.exe");

export interface AppServerClientOptions {
  executable?: string;
  requestTimeoutMs?: number;
  spawnProcess?: typeof spawn;
}

interface PendingRequest {
  method: string;
  timer: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class AppServerClient extends EventEmitter {
  private readonly executable: string;
  private readonly requestTimeoutMs: number;
  private readonly spawnProcess: typeof spawn;
  private process: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<unknown> | null = null;
  private buffer = "";
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stopping = false;

  connectionId: string | null = null;
  info: unknown = null;
  lastError: Error | null = null;
  stderrTail = "";

  constructor(options: AppServerClientOptions = {}) {
    super();
    this.executable = options.executable ?? resolveExecutable();
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  get connected() {
    return Boolean(this.process && !this.process.killed && this.info && this.connectionId);
  }

  async start() {
    if (this.connected) return this.info;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startProcess();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  stop() {
    this.stopping = true;
    const child = this.process;
    this.process = null;
    this.info = null;
    this.connectionId = null;
    this.rejectPending(new Error("thread-stream.appServer.stopped"));
    if (child && !child.killed) child.kill();
  }

  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (!this.process?.stdin.writable) {
      return Promise.reject(new Error("thread-stream.appServer.disconnected"));
    }
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`thread-stream.appServer.timeout:${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        method,
        timer,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.process!.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  notify(method: string, params: unknown = {}) {
    if (!this.process?.stdin.writable) throw new Error("thread-stream.appServer.disconnected");
    this.process.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async listThreads(query: ThreadListQuery = {}): Promise<ThreadPage> {
    const { cursor = null, limit = 50, searchTerm = null } = query;
    const response = await this.request<{ data?: unknown[]; nextCursor?: string | null }>("thread/list", {
      cursor,
      limit,
      searchTerm: searchTerm?.trim() || null,
      sortKey: "updated_at",
      sortDirection: "desc",
    });
    return {
      threads: (response.data ?? []).map(toThreadSummary),
      nextCursor: response.nextCursor ?? null,
    };
  }

  async listModels(cursor: string | null = null, limit = 100): Promise<CodexModelPage> {
    const response = await this.request<{ data?: unknown[]; nextCursor?: string | null }>("model/list", {
      cursor,
      limit,
      includeHidden: false,
    });
    return {
      models: (response.data ?? []).map(toModelSummary),
      nextCursor: response.nextCursor ?? null,
    };
  }

  async createThread(input: CreateCodexThreadInput): Promise<ThreadSnapshot> {
    const response = await this.request<{ thread?: unknown }>("thread/start", {
      model: input.model,
      cwd: input.cwd?.trim() || null,
      serviceName: "synaius-operai",
    });
    const thread = asRecord(response.thread);
    const threadId = requiredString(thread.id, "thread-stream.thread.id.missing");
    return toThreadSnapshot(thread, threadId);
  }

  async startTurn(
    threadId: string,
    message: string,
    options: { model?: string | null; effort?: string | null } = {},
  ) {
    const response = await this.request<{ turn?: unknown }>("turn/start", {
      threadId,
      input: [{ type: "text", text: message, text_elements: [] }],
      model: options.model || null,
      effort: options.effort || null,
    });
    return requiredString(asRecord(response.turn).id, "thread-stream.turn.id.missing");
  }

  async readThread(threadId: string): Promise<ThreadSnapshot> {
    const response = await this.request<{ thread?: unknown }>("thread/read", {
      threadId,
      includeTurns: true,
    });
    return toThreadSnapshot(response.thread, threadId);
  }

  async resumeThread(threadId: string): Promise<ThreadSnapshot> {
    const response = await this.request<{ thread?: unknown }>("thread/resume", { threadId });
    return toThreadSnapshot(response.thread, threadId);
  }

  async unsubscribeThread(threadId: string) {
    await this.request("thread/unsubscribe", { threadId });
  }

  async steerTurn(threadId: string, turnId: string, message: string) {
    await this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: "text", text: message, text_elements: [] }],
    });
  }

  async interruptTurn(threadId: string, turnId: string) {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  private async startProcess() {
    this.stopping = false;
    const child = this.spawnProcess(this.executable, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    }) as ChildProcessWithoutNullStreams;
    this.process = child;
    this.connectionId = randomUUID();
    this.buffer = "";
    this.stderrTail = "";
    this.lastError = null;
    const connectionId = this.connectionId;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onStdout(child, connectionId, String(chunk)));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (this.process !== child) return;
      const message = String(chunk).trim();
      if (!message) return;
      this.stderrTail = `${this.stderrTail}\n${message}`.trim().slice(-8_000);
      this.emit("log", { connectionId, level: "stderr", message });
    });
    child.on("error", (error) => this.onExit(child, error));
    child.on("exit", (code, signal) => {
      this.onExit(child, new Error(`thread-stream.appServer.exited:${code}:${signal ?? "none"}`));
    });

    const result = await this.request("initialize", {
      clientInfo: { name: "synaius", title: "SynAIus", version: "0.1.0" },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: true,
        optOutNotificationMethods: ["item/reasoning/textDelta"],
      },
    });
    if (this.process !== child) throw new Error("thread-stream.appServer.staleConnection");
    this.notify("initialized", {});
    this.info = result;
    this.emit("connected", { connectionId, info: result });
    return result;
  }

  private onStdout(
    child: ChildProcessWithoutNullStreams,
    connectionId: string,
    chunk: string,
  ) {
    if (this.process !== child || this.connectionId !== connectionId) return;
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleLine(connectionId, line);
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private handleLine(connectionId: string, line: string) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.emit("log", { connectionId, level: "parse-error", message: line });
      return;
    }
    if (Object.hasOwn(message, "id") && typeof message.method === "string") {
      this.emit("serverRequest", { connectionId, message });
      return;
    }
    if (Object.hasOwn(message, "id")) {
      const id = Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (message.error) {
        const error = message.error as { message?: string };
        pending.reject(new Error(error.message || `thread-stream.appServer.requestFailed:${pending.method}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === "string") {
      this.emit("notification", {
        connectionId,
        notification: { method: message.method, params: message.params ?? {} } satisfies AppServerNotification,
      });
    }
  }

  private onExit(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this.process !== child) return;
    const connectionId = this.connectionId;
    this.process = null;
    this.info = null;
    this.connectionId = null;
    this.lastError = error;
    this.rejectPending(error);
    if (!this.stopping) this.emit("disconnected", { connectionId, error });
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function reconnectDelayMs(attempt: number, baseMs = 1_000, maximumMs = 30_000) {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const safeBase = Math.max(100, Math.floor(baseMs));
  const safeMaximum = Math.max(safeBase, Math.floor(maximumMs));
  return Math.min(safeMaximum, safeBase * (2 ** Math.min(10, safeAttempt - 1)));
}

export function toThreadSnapshot(raw: unknown, fallbackThreadId: string): ThreadSnapshot {
  const thread = asRecord(raw);
  const threadId = stringValue(thread.id) ?? fallbackThreadId;
  const turns = Array.isArray(thread.turns) ? thread.turns.map(asRecord) : [];
  const activeTurn = [...turns].reverse().find((turn) => turn.status === "inProgress");
  return {
    threadId,
    cursor: null,
    activeTurnId: stringValue(activeTurn?.id),
    name: stringValue(thread.name),
    status: activeTurn ? "active" : runtimeStatus(thread.status),
    accessMode: "interactive",
    raw: projectThreadForViewer(thread, threadId),
  };
}

function projectThreadForViewer(thread: Record<string, unknown>, threadId: string) {
  const turns = Array.isArray(thread.turns) ? thread.turns.map(asRecord) : [];
  return {
    id: stringValue(thread.id) ?? threadId,
    name: stringValue(thread.name),
    status: structuredClone(thread.status ?? null),
    turns: turns.map((turn) => ({
      id: stringValue(turn.id),
      status: structuredClone(turn.status ?? null),
      items: (Array.isArray(turn.items) ? turn.items.map(asRecord) : [])
        .flatMap((item): Array<Record<string, unknown>> => {
          const id = stringValue(item.id);
          if (!id) return [];
          if (item.type === "agentMessage") {
            return [{ id, type: "agentMessage", text: stringValue(item.text) ?? "" }];
          }
          if (item.type === "userMessage") {
            const content = Array.isArray(item.content) ? item.content.map(asRecord) : [];
            return [{
              id,
              type: "userMessage",
              content: content.flatMap((part) => part.type === "text" && typeof part.text === "string"
                ? [{ type: "text", text: part.text }]
                : []),
            }];
          }
          return [];
        }),
    })),
  };
}

function toThreadSummary(raw: unknown): ThreadSummary {
  const thread = asRecord(raw);
  const threadId = requiredString(thread.id, "thread-stream.thread.id.missing");
  return {
    threadId,
    name: stringValue(thread.name),
    preview: (stringValue(thread.preview) ?? "").slice(0, 280),
    createdAt: numberValue(thread.createdAt),
    updatedAt: numberValue(thread.updatedAt),
    status: runtimeStatus(thread.status),
  };
}

function toModelSummary(raw: unknown) {
  const model = asRecord(raw);
  return {
    id: requiredString(model.id, "thread-stream.model.id.missing"),
    displayName: requiredString(model.displayName, "thread-stream.model.displayName.missing"),
    description: stringValue(model.description) ?? "",
    defaultReasoningEffort: stringValue(model.defaultReasoningEffort) ?? "medium",
    supportedReasoningEfforts: (Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts
      : []).flatMap((value) => {
      const effort = asRecord(value);
      const id = stringValue(effort.reasoningEffort);
      return id ? [{ id, description: stringValue(effort.description) ?? "" }] : [];
    }),
    isDefault: model.isDefault === true,
  };
}

function runtimeStatus(value: unknown): ThreadRuntimeStatus {
  const type = typeof value === "string" ? value : stringValue(asRecord(value).type);
  return ["notLoaded", "idle", "active", "systemError"].includes(type ?? "")
    ? type as ThreadRuntimeStatus
    : "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function requiredString(value: unknown, code: string) {
  const result = stringValue(value);
  if (!result) throw new Error(code);
  return result;
}

function resolveExecutable() {
  const configured = process.env.SYNAIUS_CODEX_EXECUTABLE || process.env.CODEX_EXECUTABLE;
  if (configured) return configured;
  return existsSync(DEFAULT_EXECUTABLE) ? DEFAULT_EXECUTABLE : "codex";
}
