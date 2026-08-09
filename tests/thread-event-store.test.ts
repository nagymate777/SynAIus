import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadEventStore } from "@synaius/module-thread-stream/server";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("durable thread event store", () => {
  it("persists ordered events, cursors, snapshots, and subscriptions across restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "synaius-thread-store-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "events.sqlite");
    let store = new ThreadEventStore(databasePath);
    const first = store.appendEvent({
      threadId: "thread-1",
      turnId: "turn-1",
      method: "turn/started",
      source: "app-server",
      connectionId: "connection-1",
      receivedAt: "2026-08-09T10:00:00.000Z",
      raw: { method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } },
    });
    const second = store.appendEvent({
      threadId: "thread-1",
      turnId: "turn-1",
      method: "item/agentMessage/delta",
      source: "app-server",
      connectionId: "connection-1",
      receivedAt: "2026-08-09T10:00:01.000Z",
      raw: { method: "item/agentMessage/delta", params: { threadId: "thread-1", delta: "Szia" } },
    });
    store.saveSnapshot({
      threadId: "thread-1",
      cursor: null,
      activeTurnId: "turn-1",
      name: "Teszt",
      status: "active",
      accessMode: "interactive",
      raw: { id: "thread-1", turns: [] },
    });
    store.attachThread("thread-1");
    store.markResumed("thread-1");
    store.close();

    store = new ThreadEventStore(databasePath);
    expect(first.cursor).not.toBe(second.cursor);
    expect(store.eventsAfter("thread-1", first.cursor)).toEqual([second]);
    expect(store.latestCursor("thread-1")).toBe(second.cursor);
    expect(store.readSnapshot("thread-1")).toMatchObject({
      cursor: second.cursor,
      activeTurnId: "turn-1",
      status: "active",
    });
    expect(store.attachedThreadIds()).toEqual(["thread-1"]);
    store.saveInteraction({
      requestId: "approval-1",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      createdAt: "2026-08-09T10:00:02.000Z",
      kind: "fileApproval",
      reason: "Teszt",
      grantRoot: "C:/project",
    }, "connection-1");
    expect(store.pendingInteractions("thread-1")).toMatchObject([{
      requestId: "approval-1",
      kind: "fileApproval",
    }]);
    expect(store.readInteraction("thread-1", "approval-1")?.connectionId).toBe("connection-1");
    expect(store.resolveInteraction("approval-1")).toBe(true);
    expect(store.pendingInteractions("thread-1")).toEqual([]);
    store.detachThread("thread-1");
    expect(store.attachedThreadIds()).toEqual([]);
    store.close();
  });

  it("rejects malformed replay cursors", () => {
    const directory = mkdtempSync(join(tmpdir(), "synaius-thread-store-"));
    temporaryDirectories.push(directory);
    const store = new ThreadEventStore(join(directory, "events.sqlite"));
    expect(() => store.eventsAfter("thread-1", "invalid")).toThrow("thread-stream.cursor.invalid");
    store.close();
  });
});
