import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import type {
  AppServerNotification,
  CodexModelPage,
  CreateCodexThreadInput,
  DurableThreadEvent,
  PendingThreadInteraction,
  ServerRequestId,
  StreamCursor,
  ThreadInteractionResponse,
  ThreadPage,
  ThreadListQuery,
  ThreadSnapshot,
} from "@synaius/protocol";
import { AppServerClient, reconnectDelayMs, toThreadSnapshot } from "./app-server-client.ts";
import { ThreadEventStore } from "./store.ts";

export interface ThreadStreamServiceOptions {
  store: ThreadEventStore;
  client?: ThreadStreamAppServerClient;
  reconnectBaseMs?: number;
  reconnectMaximumMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  pollIntervalMs?: number;
  setPollInterval?: typeof setInterval;
  clearPollInterval?: typeof clearInterval;
}

export interface ThreadStreamAppServerClient {
  readonly connected: boolean;
  readonly connectionId: string | null;
  start(): Promise<unknown>;
  stop(): void;
  listThreads(query?: ThreadListQuery): Promise<ThreadPage>;
  listModels(cursor?: string | null, limit?: number): Promise<CodexModelPage>;
  createThread(input: CreateCodexThreadInput): Promise<ThreadSnapshot>;
  startTurn(
    threadId: string,
    message: string,
    options?: { model?: string | null; effort?: string | null },
  ): Promise<string>;
  readThread(threadId: string): Promise<ThreadSnapshot>;
  resumeThread(threadId: string): Promise<ThreadSnapshot>;
  unsubscribeThread(threadId: string): Promise<void>;
  steerTurn(threadId: string, turnId: string, message: string): Promise<void>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  respondToServerRequest(requestId: ServerRequestId, result: unknown): void;
  respondToServerRequestError(requestId: ServerRequestId, code: number, message: string): void;
  on(event: "notification", listener: (payload: {
    connectionId: string;
    notification: AppServerNotification;
  }) => void): this;
  on(event: "serverRequest", listener: (payload: {
    connectionId: string;
    message: unknown;
  }) => void): this;
  on(event: "disconnected", listener: (payload: {
    connectionId: string | null;
    error: Error;
  }) => void): this;
}

export interface ThreadStreamServiceStatus {
  status: "connecting" | "connected" | "reconnecting" | "disconnected" | "stopped";
  connected: boolean;
  reconnectAttempt: number;
  nextReconnectAt: string | null;
  connectionId: string | null;
  lastError: string | null;
}

export class ThreadStreamService {
  private readonly store: ThreadEventStore;
  private readonly client: ThreadStreamAppServerClient;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaximumMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly pollIntervalMs: number;
  private readonly setPollInterval: typeof setInterval;
  private readonly clearPollInterval: typeof clearInterval;
  private readonly events = new EventEmitter();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private nextReconnectAt: string | null = null;
  private connecting = false;
  private stopped = true;
  private lastError: Error | null = null;
  private readonly observeOnlyThreadIds = new Set<string>();
  private readonly snapshotDigests = new Map<string, string>();
  private readonly pollers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly attachments = new Map<string, string>();

  constructor(options: ThreadStreamServiceOptions) {
    this.store = options.store;
    this.client = options.client ?? new AppServerClient();
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaximumMs = options.reconnectMaximumMs ?? 30_000;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.setPollInterval = options.setPollInterval ?? setInterval;
    this.clearPollInterval = options.clearPollInterval ?? clearInterval;
    this.client.on("notification", ({ connectionId, notification }) => {
      this.persistThenBroadcast(connectionId, notification);
    });
    this.client.on("serverRequest", ({ connectionId, message }) => {
      this.handleServerRequest(connectionId, message);
    });
    this.client.on("disconnected", ({ connectionId, error }) => {
      if (this.stopped) return;
      this.lastError = error;
      this.stopAllPolling();
      const clearedThreadIds = this.store.clearInteractions(connectionId ?? undefined);
      clearedThreadIds.forEach((threadId) => {
        this.appendGatewayEvent(threadId, "gateway/interactionsCleared", {});
      });
      this.broadcastGatewayEvent("gateway/disconnected", connectionId ?? "disconnected", {
        error: error.message,
      });
      this.scheduleReconnect();
    });
  }

  async start() {
    if (!this.stopped) return;
    this.store.clearInteractions();
    this.stopped = false;
    await this.connect();
  }

  stop() {
    this.stopped = true;
    this.connecting = false;
    if (this.reconnectTimer) this.clearTimer(this.reconnectTimer);
    this.reconnectTimer = null;
    this.nextReconnectAt = null;
    this.stopAllPolling();
    this.client.stop();
  }

  close() {
    this.stop();
    this.store.close();
  }

  status(): ThreadStreamServiceStatus {
    const connected = this.client.connected;
    return {
      status: this.stopped
        ? "stopped"
        : connected
          ? "connected"
          : this.connecting
            ? "connecting"
            : this.reconnectTimer
              ? "reconnecting"
              : "disconnected",
      connected,
      reconnectAttempt: this.reconnectAttempt,
      nextReconnectAt: this.nextReconnectAt,
      connectionId: this.client.connectionId,
      lastError: this.lastError?.message ?? null,
    };
  }

  listThreads(query: ThreadListQuery = {}): Promise<ThreadPage> {
    return this.client.listThreads(query);
  }

  listModels(cursor: string | null = null, limit = 100): Promise<CodexModelPage> {
    return this.client.listModels(cursor, limit);
  }

  listInteractions(threadId: string) {
    return this.store.pendingInteractions(threadId);
  }

  async respondToInteraction(
    threadId: string,
    requestId: ServerRequestId,
    response: ThreadInteractionResponse,
  ) {
    const pending = this.store.readInteraction(threadId, requestId);
    if (!pending) throw Object.assign(new Error("thread-stream.interaction.notFound"), { statusCode: 404 });
    if (pending.connectionId !== this.client.connectionId) {
      throw Object.assign(new Error("thread-stream.interaction.stale"), { statusCode: 409 });
    }
    const result = interactionResult(pending.interaction, response);
    this.client.respondToServerRequest(requestId, result);
    this.store.resolveInteraction(requestId);
    this.appendGatewayEvent(threadId, "gateway/interactionResponded", { requestId });
  }

  async createThread(input: CreateCodexThreadInput): Promise<ThreadSnapshot> {
    const message = input.message.trim();
    if (!message) throw new Error("thread-stream.message.required");
    if (!input.model.trim()) throw new Error("thread-stream.model.required");
    const snapshot = await this.client.createThread({
      ...input,
      model: input.model.trim(),
      cwd: input.cwd?.trim() || null,
      message,
    });
    this.store.saveSnapshot(snapshot);
    const turnId = await this.client.startTurn(snapshot.threadId, message, {
      model: input.model.trim(),
      effort: input.effort?.trim() || null,
    });
    const activeSnapshot = { ...snapshot, activeTurnId: turnId, status: "active" as const };
    this.store.saveSnapshot(activeSnapshot);
    return { ...activeSnapshot, cursor: this.store.latestCursor(snapshot.threadId) };
  }

  async readThread(threadId: string): Promise<ThreadSnapshot> {
    try {
      const snapshot = await this.client.readThread(threadId);
      const visibleSnapshot = this.observeOnlyThreadIds.has(threadId)
        ? { ...snapshot, accessMode: "observe" as const }
        : snapshot;
      this.store.saveSnapshot(visibleSnapshot);
      return { ...visibleSnapshot, cursor: this.store.latestCursor(threadId) };
    } catch (error) {
      const cached = this.store.readSnapshot(threadId);
      if (cached) return cached;
      throw error;
    }
  }

  async resumeThread(threadId: string): Promise<ThreadSnapshot> {
    const snapshot = await this.client.resumeThread(threadId);
    this.observeOnlyThreadIds.delete(threadId);
    this.stopPolling(threadId);
    this.store.markResumed(threadId);
    this.store.saveSnapshot(snapshot);
    return { ...snapshot, cursor: this.store.latestCursor(threadId) };
  }

  async attachThread(threadId: string) {
    this.store.attachThread(threadId);
    const attachmentId = randomUUID();
    this.attachments.set(attachmentId, threadId);
    try {
      return { attachmentId, snapshot: await this.attachSnapshot(threadId) };
    } catch (error) {
      this.attachments.delete(attachmentId);
      if (![...this.attachments.values()].includes(threadId)) this.store.detachThread(threadId);
      throw error;
    }
  }

  async releaseAttachment(threadId: string, attachmentId: string) {
    if (this.attachments.get(attachmentId) !== threadId) return false;
    this.attachments.delete(attachmentId);
    if (![...this.attachments.values()].includes(threadId)) {
      this.store.detachThread(threadId);
      this.observeOnlyThreadIds.delete(threadId);
      this.stopPolling(threadId);
      if (this.client.connected) await this.client.unsubscribeThread(threadId);
    }
    return true;
  }

  hasAttachment(threadId: string, attachmentId: string) {
    return this.attachments.get(attachmentId) === threadId;
  }

  async startTurn(threadId: string, message: string) {
    const normalized = message.trim();
    if (!normalized) throw new Error("thread-stream.message.required");
    if (this.observeOnlyThreadIds.has(threadId)) {
      throw new Error("thread-stream.thread.observeOnly");
    }
    const turnId = await this.client.startTurn(threadId, normalized);
    const current = this.store.readSnapshot(threadId) ?? await this.client.readThread(threadId);
    this.store.saveSnapshot({ ...current, activeTurnId: turnId, status: "active" });
  }

  private async attachSnapshot(threadId: string): Promise<ThreadSnapshot> {
    if (this.observeOnlyThreadIds.has(threadId)) {
      const cached = this.store.readSnapshot(threadId);
      if (cached) {
        this.startPolling(threadId);
        return cached;
      }
    }
    if (this.client.connected) {
      try {
        return await this.resumeThread(threadId);
      } catch (error) {
        if (!isActiveWriterError(error)) throw error;
        return this.attachReadOnly(threadId);
      }
    }
    const cached = this.store.readSnapshot(threadId);
    if (cached) return cached;
    throw new Error("thread-stream.appServer.disconnected");
  }

  steerTurn(threadId: string, turnId: string, message: string) {
    if (!message.trim()) throw new Error("thread-stream.message.required");
    return this.client.steerTurn(threadId, turnId, message.trim());
  }

  interruptTurn(threadId: string, turnId: string) {
    return this.client.interruptTurn(threadId, turnId);
  }

  eventsAfter(
    threadId: string,
    after: StreamCursor | null = null,
    limit = 500,
    through: StreamCursor | null = null,
  ) {
    return this.store.eventsAfter(threadId, after, limit, through);
  }

  latestCursor(threadId: string) {
    return this.store.latestCursor(threadId);
  }

  subscribe(threadId: string, listener: (event: DurableThreadEvent) => void) {
    const eventName = `thread:${threadId}`;
    this.events.on(eventName, listener);
    return () => this.events.off(eventName, listener);
  }

  private async connect() {
    if (this.stopped || this.connecting || this.client.connected) return;
    this.connecting = true;
    try {
      await this.client.start();
      const attachedThreadIds = this.store.attachedThreadIds();
      for (const threadId of attachedThreadIds) {
        try {
          const snapshot = await this.client.resumeThread(threadId);
          this.observeOnlyThreadIds.delete(threadId);
          this.stopPolling(threadId);
          this.store.markResumed(threadId);
          this.store.saveSnapshot(snapshot);
        } catch (error) {
          if (isActiveWriterError(error)) {
            await this.attachReadOnly(threadId);
          } else {
            this.appendGatewayEvent(threadId, "gateway/resumeFailed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      const recoveredAttempt = this.reconnectAttempt;
      this.reconnectAttempt = 0;
      this.nextReconnectAt = null;
      this.lastError = null;
      this.broadcastGatewayEvent(
        recoveredAttempt > 0 ? "gateway/reconnected" : "gateway/connected",
        this.client.connectionId ?? "connected",
        { resumedThreadCount: attachedThreadIds.length, reconnectAttempt: recoveredAttempt },
      );
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.client.stop();
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer || this.client.connected) return;
    this.reconnectAttempt += 1;
    const delayMs = reconnectDelayMs(
      this.reconnectAttempt,
      this.reconnectBaseMs,
      this.reconnectMaximumMs,
    );
    this.nextReconnectAt = new Date(Date.now() + delayMs).toISOString();
    this.broadcastGatewayEvent("gateway/reconnectScheduled", "reconnect", {
      attempt: this.reconnectAttempt,
      delayMs,
      nextReconnectAt: this.nextReconnectAt,
    });
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      this.nextReconnectAt = null;
      void this.connect();
    }, delayMs);
  }

  private persistThenBroadcast(connectionId: string, notification: AppServerNotification) {
    const params = asRecord(notification.params);
    const threadId = extractThreadId(params);
    if (!threadId) return null;
    const turnId = extractTurnId(params);
    if (notification.method === "serverRequest/resolved") {
      const requestId = requestIdValue(params.requestId);
      if (requestId !== null) this.store.resolveInteraction(requestId);
    } else if (notification.method === "turn/completed") {
      this.store.clearTurnInteractions(threadId, turnId);
    }
    const event = this.store.appendEvent({
      threadId,
      turnId,
      method: notification.method,
      source: "app-server",
      connectionId,
      raw: notification,
    });
    this.updateSnapshotFromNotification(threadId, turnId, notification);
    this.events.emit(`thread:${threadId}`, event);
    return event;
  }

  private handleServerRequest(connectionId: string, message: unknown) {
    const request = asRecord(message);
    const requestId = requestIdValue(request.id);
    const method = stringValue(request.method);
    if (requestId === null || !method) return;
    const interaction = projectServerRequest(requestId, method, request.params);
    if (!interaction) {
      this.client.respondToServerRequestError(
        requestId,
        -32601,
        "thread-stream.serverRequest.unsupported",
      );
      const threadId = extractThreadId(asRecord(request.params));
      if (threadId) {
        this.appendGatewayEvent(threadId, "gateway/serverRequestRejected", { method, requestId });
      }
      return;
    }
    this.store.saveInteraction(interaction, connectionId);
    this.appendGatewayEvent(interaction.threadId, "gateway/interactionRequested", { interaction });
  }

  private updateSnapshotFromNotification(
    threadId: string,
    turnId: string | null,
    notification: AppServerNotification,
  ) {
    const params = asRecord(notification.params);
    if (notification.method === "thread/started" && params.thread) {
      this.store.saveSnapshot(toThreadSnapshot(params.thread, threadId));
      return;
    }
    const current = this.store.readSnapshot(threadId);
    if (!current) return;
    if (notification.method === "turn/started") {
      this.store.saveSnapshot({ ...current, activeTurnId: turnId, status: "active" });
    } else if (notification.method === "turn/completed") {
      this.store.saveSnapshot({ ...current, activeTurnId: null, status: "idle" });
    } else if (notification.method === "thread/status/changed") {
      this.store.saveSnapshot({ ...current, status: normalizeStatus(params.status) });
    } else if (notification.method === "thread/name/updated") {
      this.store.saveSnapshot({ ...current, name: stringValue(params.name) });
    }
  }

  private appendGatewayEvent(threadId: string, method: string, params: Record<string, unknown>) {
    const event = this.store.appendEvent({
      threadId,
      turnId: null,
      method,
      source: "gateway",
      connectionId: this.client.connectionId ?? "gateway",
      raw: { method, params },
    });
    this.events.emit(`thread:${threadId}`, event);
  }

  private async attachReadOnly(threadId: string) {
    const snapshot = {
      ...await this.client.readThread(threadId),
      accessMode: "observe" as const,
    };
    this.observeOnlyThreadIds.add(threadId);
    this.store.saveSnapshot(snapshot);
    this.snapshotDigests.set(threadId, snapshotDigest(snapshot));
    this.startPolling(threadId);
    this.appendGatewayEvent(threadId, "gateway/readOnlyAttached", {
      accessMode: "observe",
    });
    return { ...snapshot, cursor: this.store.latestCursor(threadId) };
  }

  private startPolling(threadId: string) {
    if (this.pollers.has(threadId) || this.stopped) return;
    const timer = this.setPollInterval(() => void this.pollThread(threadId), this.pollIntervalMs);
    this.pollers.set(threadId, timer);
  }

  private stopPolling(threadId: string) {
    const timer = this.pollers.get(threadId);
    if (timer) this.clearPollInterval(timer);
    this.pollers.delete(threadId);
    this.snapshotDigests.delete(threadId);
  }

  private stopAllPolling() {
    [...this.pollers].forEach(([threadId]) => this.stopPolling(threadId));
  }

  private async pollThread(threadId: string) {
    if (!this.client.connected || !this.observeOnlyThreadIds.has(threadId)) return;
    try {
      const snapshot = {
        ...await this.client.readThread(threadId),
        accessMode: "observe" as const,
      };
      const digest = snapshotDigest(snapshot);
      if (this.snapshotDigests.get(threadId) === digest) return;
      this.snapshotDigests.set(threadId, digest);
      this.store.saveSnapshot(snapshot);
      this.appendGatewayEvent(threadId, "gateway/snapshotChanged", {
        activeTurnId: snapshot.activeTurnId,
        name: snapshot.name,
        status: snapshot.status,
        accessMode: snapshot.accessMode,
      });
    } catch (error) {
      this.appendGatewayEvent(threadId, "gateway/pollFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private broadcastGatewayEvent(method: string, connectionId: string, params: Record<string, unknown>) {
    for (const threadId of this.store.attachedThreadIds()) {
      const event = this.store.appendEvent({
        threadId,
        turnId: null,
        method,
        source: "gateway",
        connectionId,
        raw: { method, params },
      });
      this.events.emit(`thread:${threadId}`, event);
    }
  }
}

export function projectServerRequest(
  requestId: ServerRequestId,
  method: string,
  rawParams: unknown,
): PendingThreadInteraction | null {
  const params = asRecord(rawParams);
  const threadId = extractThreadId(params);
  if (!threadId) return null;
  const base = {
    requestId,
    threadId,
    turnId: stringValue(params.turnId),
    itemId: stringValue(params.itemId),
    createdAt: new Date().toISOString(),
  };
  if (method === "item/commandExecution/requestApproval") {
    const network = asRecord(params.networkApprovalContext);
    return {
      ...base,
      kind: "commandApproval",
      reason: stringValue(params.reason),
      command: stringValue(params.command),
      cwd: stringValue(params.cwd),
      networkHost: stringValue(network.host),
      networkProtocol: stringValue(network.protocol),
    };
  }
  if (method === "item/fileChange/requestApproval") {
    return {
      ...base,
      kind: "fileApproval",
      reason: stringValue(params.reason),
      grantRoot: stringValue(params.grantRoot),
    };
  }
  if (method === "item/tool/requestUserInput") {
    const questions = (Array.isArray(params.questions) ? params.questions : []).flatMap((value) => {
      const question = asRecord(value);
      const id = stringValue(question.id);
      const header = stringValue(question.header);
      const prompt = stringValue(question.question);
      if (!id || !header || !prompt) return [];
      const options = question.options === null
        ? null
        : (Array.isArray(question.options) ? question.options : []).flatMap((candidate) => {
            const option = asRecord(candidate);
            const label = stringValue(option.label);
            const description = stringValue(option.description);
            return label && description ? [{ label, description }] : [];
          });
      return [{
        id,
        header,
        question: prompt,
        isOther: question.isOther === true,
        isSecret: !!question.isSecret,
        options,
      }];
    });
    if (!questions.length) return null;
    return {
      ...base,
      kind: "userInput",
      questions,
      isBlocking: params.isBlocking === true,
    };
  }
  if (method === "item/permissions/requestApproval") {
    return {
      ...base,
      kind: "permissionsApproval",
      reason: stringValue(params.reason),
      cwd: stringValue(params.cwd),
      requestedPermissions: structuredClone(params.permissions ?? {}),
    };
  }
  if (method === "mcpServer/elicitation/request") {
    const mode = params.mode;
    if (mode !== "form" && mode !== "openai/form" && mode !== "url") return null;
    const serverName = stringValue(params.serverName);
    const message = stringValue(params.message);
    if (!serverName || !message) return null;
    return {
      ...base,
      kind: "mcpElicitation",
      serverName,
      mode,
      message,
      url: mode === "url" ? stringValue(params.url) : null,
    };
  }
  return null;
}

function interactionResult(
  interaction: PendingThreadInteraction,
  response: ThreadInteractionResponse,
) {
  if ((interaction.kind === "commandApproval" || interaction.kind === "fileApproval")
    && response.kind === "approval") {
    return { decision: response.decision };
  }
  if (interaction.kind === "userInput" && response.kind === "userInput") {
    const answers: Record<string, { answers: string[] }> = {};
    for (const question of interaction.questions) {
      const values = response.answers[question.id];
      if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== "string"
        || !values[0].trim()) {
        throw invalidInteractionResponse();
      }
      if (question.options?.length && !question.isOther
        && !question.options.some((option) => option.label === values[0])) {
        throw invalidInteractionResponse();
      }
      answers[question.id] = { answers: [values[0]] };
    }
    return { answers };
  }
  if (interaction.kind === "permissionsApproval" && response.kind === "permissions") {
    if (response.decision === "decline") return { permissions: {}, scope: "turn" };
    const requested = asRecord(interaction.requestedPermissions);
    const permissions: Record<string, unknown> = {};
    if (requested.network !== null && requested.network !== undefined) {
      permissions.network = structuredClone(requested.network);
    }
    if (requested.fileSystem !== null && requested.fileSystem !== undefined) {
      permissions.fileSystem = structuredClone(requested.fileSystem);
    }
    return {
      permissions,
      scope: response.decision === "grantSession" ? "session" : "turn",
    };
  }
  if (interaction.kind === "mcpElicitation" && response.kind === "mcpElicitation") {
    return { action: response.action, content: null, _meta: null };
  }
  throw invalidInteractionResponse();
}

function invalidInteractionResponse() {
  return Object.assign(new Error("thread-stream.interaction.response.invalid"), { statusCode: 400 });
}

function isActiveWriterError(error: unknown) {
  return error instanceof Error && error.message.toLocaleLowerCase().includes("active writer");
}

function snapshotDigest(snapshot: ThreadSnapshot) {
  return createHash("sha256").update(JSON.stringify({
    activeTurnId: snapshot.activeTurnId,
    name: snapshot.name,
    status: snapshot.status,
    raw: snapshot.raw,
  })).digest("hex");
}

function extractThreadId(params: Record<string, unknown>) {
  return stringValue(params.threadId)
    ?? stringValue(asRecord(params.thread).id)
    ?? stringValue(params.conversationId);
}

function extractTurnId(params: Record<string, unknown>) {
  return stringValue(params.turnId) ?? stringValue(asRecord(params.turn).id);
}

function normalizeStatus(value: unknown): ThreadSnapshot["status"] {
  const type = typeof value === "string" ? value : stringValue(asRecord(value).type);
  return ["notLoaded", "idle", "active", "systemError"].includes(type ?? "")
    ? type as ThreadSnapshot["status"]
    : "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function requestIdValue(value: unknown): ServerRequestId | null {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
