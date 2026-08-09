import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AppServerNotification,
  CodexModelPage,
  CreateCodexThreadInput,
  ServerRequestId,
  ThreadPage,
  ThreadSnapshot,
} from "@synaius/protocol";
import {
  ThreadEventStore,
  ThreadStreamService,
  type ThreadStreamAppServerClient,
} from "@synaius/module-thread-stream/server";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("thread stream service", () => {
  it("persists every notification before broadcasting it and resumes durable subscriptions", async () => {
    const directory = mkdtempSync(join(tmpdir(), "synaius-thread-service-"));
    temporaryDirectories.push(directory);
    const store = new ThreadEventStore(join(directory, "events.sqlite"));
    store.attachThread("thread-1");
    const client = new FakeAppServerClient();
    const service = new ThreadStreamService({ store, client });
    await service.start();
    expect(client.resumed).toEqual(["thread-1"]);

    let storedBeforeBroadcast = false;
    const unsubscribe = service.subscribe("thread-1", (event) => {
      storedBeforeBroadcast = store.eventsAfter("thread-1").some((stored) => stored.cursor === event.cursor);
    });
    client.notification({
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-2" } },
    });

    expect(storedBeforeBroadcast).toBe(true);
    expect(store.eventsAfter("thread-1").at(-1)).toMatchObject({
      method: "turn/started",
      turnId: "turn-2",
      source: "app-server",
    });
    expect(store.readSnapshot("thread-1")).toMatchObject({ activeTurnId: "turn-2", status: "active" });
    unsubscribe();
    service.close();
  });

  it("uses bounded backoff and reconnects after an app-server exit", async () => {
    const directory = mkdtempSync(join(tmpdir(), "synaius-thread-service-"));
    temporaryDirectories.push(directory);
    const store = new ThreadEventStore(join(directory, "events.sqlite"));
    store.attachThread("thread-1");
    const client = new FakeAppServerClient();
    let reconnect: (() => void) | null = null;
    const service = new ThreadStreamService({
      store,
      client,
      reconnectBaseMs: 100,
      reconnectMaximumMs: 200,
      setTimer: ((callback: () => void) => {
        reconnect = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimer: (() => undefined) as typeof clearTimeout,
    });
    await service.start();
    client.disconnect();
    expect(service.status()).toMatchObject({ status: "reconnecting", reconnectAttempt: 1 });
    expect(store.eventsAfter("thread-1").map((event) => event.method)).toContain("gateway/reconnectScheduled");
    reconnect!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.startCount).toBe(2);
    expect(client.resumed).toEqual(["thread-1", "thread-1"]);
    expect(service.status()).toMatchObject({ status: "connected", reconnectAttempt: 0 });
    service.close();
  });

  it("falls back to observable polling when another Codex client owns the active writer", async () => {
    const directory = mkdtempSync(join(tmpdir(), "synaius-thread-service-"));
    temporaryDirectories.push(directory);
    const store = new ThreadEventStore(join(directory, "events.sqlite"));
    const client = new FakeAppServerClient();
    client.activeWriter = true;
    let poll: (() => void) | null = null;
    const service = new ThreadStreamService({
      store,
      client,
      setPollInterval: ((callback: () => void) => {
        poll = callback;
        return 2 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearPollInterval: (() => undefined) as typeof clearInterval,
    });
    await service.start();
    const attached = await service.attachThread("thread-1");
    expect(attached.snapshot.accessMode).toBe("observe");
    expect(store.eventsAfter("thread-1").at(-1)?.method).toBe("gateway/readOnlyAttached");
    expect((await service.attachThread("thread-1")).snapshot.accessMode).toBe("observe");
    expect(client.resumeAttempts).toBe(1);

    client.currentSnapshot = {
      ...snapshot("thread-1"),
      activeTurnId: "turn-live",
      status: "active",
      raw: { id: "thread-1", turns: [{ id: "turn-live", status: "inProgress", items: [] }] },
    };
    poll!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.readSnapshot("thread-1")).toMatchObject({
      activeTurnId: "turn-live",
      accessMode: "observe",
    });
    expect(store.eventsAfter("thread-1").at(-1)?.method).toBe("gateway/snapshotChanged");
    service.close();
  });

  it("creates a thread, starts its first turn, starts later turns, and releases attachments", async () => {
    const directory = mkdtempSync(join(tmpdir(), "synaius-thread-service-"));
    temporaryDirectories.push(directory);
    const store = new ThreadEventStore(join(directory, "events.sqlite"));
    const client = new FakeAppServerClient();
    const service = new ThreadStreamService({ store, client });
    await service.start();

    const created = await service.createThread({
      model: "test-model",
      effort: "high",
      cwd: "C:/project",
      message: "Első utasítás",
    });
    expect(created).toMatchObject({ threadId: "thread-created", activeTurnId: "turn-1", status: "active" });
    expect(client.created).toMatchObject({ model: "test-model", effort: "high", cwd: "C:/project" });
    expect(client.startedTurns).toEqual([
      { threadId: "thread-created", message: "Első utasítás", model: "test-model", effort: "high" },
    ]);

    const attachment = await service.attachThread("thread-created");
    expect(store.attachedThreadIds()).toEqual(["thread-created"]);
    expect(service.hasAttachment("thread-created", attachment.attachmentId)).toBe(true);
    expect(await service.releaseAttachment("thread-created", attachment.attachmentId)).toBe(true);
    expect(store.attachedThreadIds()).toEqual([]);
    expect(client.unsubscribed).toEqual(["thread-created"]);

    client.currentSnapshot = snapshot("thread-created");
    await service.startTurn("thread-created", "Következő utasítás");
    expect(client.startedTurns.at(-1)).toMatchObject({
      threadId: "thread-created",
      message: "Következő utasítás",
    });
    service.close();
  });

  it("persists approval requests before broadcasting and returns decisions on the same connection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "synaius-thread-service-"));
    temporaryDirectories.push(directory);
    const store = new ThreadEventStore(join(directory, "events.sqlite"));
    const client = new FakeAppServerClient();
    const service = new ThreadStreamService({ store, client });
    await service.start();

    let persistedBeforeBroadcast = false;
    service.subscribe("thread-approval", () => {
      persistedBeforeBroadcast = service.listInteractions("thread-approval").length === 1;
    });
    client.serverRequest({
      id: 17,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-approval",
        turnId: "turn-1",
        itemId: "item-1",
        reason: "Hálózati hozzáférés",
        command: "tool --check",
        cwd: "C:/project",
        networkApprovalContext: { host: "example.test", protocol: "https" },
      },
    });

    expect(persistedBeforeBroadcast).toBe(true);
    expect(service.listInteractions("thread-approval")).toMatchObject([{
      requestId: 17,
      kind: "commandApproval",
      networkHost: "example.test",
      command: "tool --check",
    }]);
    await service.respondToInteraction("thread-approval", 17, {
      kind: "approval",
      decision: "accept",
    });
    expect(client.serverResponses).toEqual([{ requestId: 17, result: { decision: "accept" } }]);
    expect(service.listInteractions("thread-approval")).toEqual([]);
    service.close();
  });

  it("keeps user secrets out of the event log and fails closed for unknown requests", async () => {
    const directory = mkdtempSync(join(tmpdir(), "synaius-thread-service-"));
    temporaryDirectories.push(directory);
    const store = new ThreadEventStore(join(directory, "events.sqlite"));
    const client = new FakeAppServerClient();
    const service = new ThreadStreamService({ store, client });
    await service.start();

    client.serverRequest({
      id: "question-1",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-question",
        turnId: "turn-1",
        itemId: "item-1",
        isBlocking: true,
        questions: [{
          id: "secret",
          header: "Titok",
          question: "Add meg",
          isOther: false,
          isSecret: true,
          options: null,
        }],
      },
    });
    await service.respondToInteraction("thread-question", "question-1", {
      kind: "userInput",
      answers: { secret: ["private-answer"] },
    });
    expect(client.serverResponses.at(-1)).toMatchObject({
      requestId: "question-1",
      result: { answers: { secret: { answers: ["private-answer"] } } },
    });
    expect(JSON.stringify(store.eventsAfter("thread-question"))).not.toContain("private-answer");

    client.serverRequest({
      id: 99,
      method: "item/tool/call",
      params: { threadId: "thread-question", turnId: "turn-1" },
    });
    expect(client.serverErrors).toEqual([{
      requestId: 99,
      code: -32601,
      message: "thread-stream.serverRequest.unsupported",
    }]);
    service.close();
  });
});

class FakeAppServerClient extends EventEmitter implements ThreadStreamAppServerClient {
  connected = false;
  connectionId: string | null = null;
  startCount = 0;
  resumed: string[] = [];
  resumeAttempts = 0;
  activeWriter = false;
  currentSnapshot: ThreadSnapshot | null = null;
  created: CreateCodexThreadInput | null = null;
  startedTurns: Array<{
    threadId: string;
    message: string;
    model?: string | null;
    effort?: string | null;
  }> = [];
  unsubscribed: string[] = [];
  serverResponses: Array<{ requestId: ServerRequestId; result: unknown }> = [];
  serverErrors: Array<{ requestId: ServerRequestId; code: number; message: string }> = [];

  async start() {
    this.startCount += 1;
    this.connected = true;
    this.connectionId = `connection-${this.startCount}`;
    return {};
  }

  stop() {
    this.connected = false;
    this.connectionId = null;
  }

  async listThreads(): Promise<ThreadPage> {
    return { threads: [], nextCursor: null };
  }

  async listModels(): Promise<CodexModelPage> {
    return { models: [], nextCursor: null };
  }

  async createThread(input: CreateCodexThreadInput) {
    this.created = input;
    return snapshot("thread-created");
  }

  async startTurn(
    threadId: string,
    message: string,
    options: { model?: string | null; effort?: string | null } = {},
  ) {
    this.startedTurns.push({ threadId, message, ...options });
    return `turn-${this.startedTurns.length}`;
  }

  async readThread(threadId: string) {
    return this.currentSnapshot ?? snapshot(threadId);
  }

  async resumeThread(threadId: string) {
    this.resumeAttempts += 1;
    if (this.activeWriter) throw new Error(`thread ${threadId} already has an active writer`);
    this.resumed.push(threadId);
    return snapshot(threadId);
  }

  async unsubscribeThread(threadId: string) {
    this.unsubscribed.push(threadId);
  }

  async steerTurn() {}
  async interruptTurn() {}

  respondToServerRequest(requestId: ServerRequestId, result: unknown) {
    this.serverResponses.push({ requestId, result });
  }

  respondToServerRequestError(requestId: ServerRequestId, code: number, message: string) {
    this.serverErrors.push({ requestId, code, message });
  }

  notification(notification: AppServerNotification) {
    this.emit("notification", { connectionId: this.connectionId!, notification });
  }

  serverRequest(message: unknown) {
    this.emit("serverRequest", { connectionId: this.connectionId!, message });
  }

  disconnect() {
    const connectionId = this.connectionId;
    this.connected = false;
    this.connectionId = null;
    this.emit("disconnected", { connectionId, error: new Error("exited") });
  }
}

function snapshot(threadId: string): ThreadSnapshot {
  return {
    threadId,
    cursor: null,
    activeTurnId: null,
    name: null,
    status: "idle",
    accessMode: "interactive",
    raw: { id: threadId, turns: [] },
  };
}
