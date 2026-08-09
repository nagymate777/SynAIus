import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppServerNotification, ThreadPage, ThreadSnapshot } from "@synaius/protocol";
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
    expect(attached.accessMode).toBe("observe");
    expect(store.eventsAfter("thread-1").at(-1)?.method).toBe("gateway/readOnlyAttached");
    expect((await service.attachThread("thread-1")).accessMode).toBe("observe");
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
});

class FakeAppServerClient extends EventEmitter implements ThreadStreamAppServerClient {
  connected = false;
  connectionId: string | null = null;
  startCount = 0;
  resumed: string[] = [];
  resumeAttempts = 0;
  activeWriter = false;
  currentSnapshot: ThreadSnapshot | null = null;

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

  async readThread(threadId: string) {
    return this.currentSnapshot ?? snapshot(threadId);
  }

  async resumeThread(threadId: string) {
    this.resumeAttempts += 1;
    if (this.activeWriter) throw new Error(`thread ${threadId} already has an active writer`);
    this.resumed.push(threadId);
    return snapshot(threadId);
  }

  async steerTurn() {}
  async interruptTurn() {}

  notification(notification: AppServerNotification) {
    this.emit("notification", { connectionId: this.connectionId!, notification });
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
