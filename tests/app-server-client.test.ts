import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  AppServerClient,
  reconnectDelayMs,
  toThreadSnapshot,
} from "@synaius/module-thread-stream/server";

describe("Codex app-server client", () => {
  it("performs the required handshake and parses split JSONL notifications", async () => {
    const child = fakeChild();
    const outbound: Array<Record<string, unknown>> = [];
    child.stdin.on("data", (chunk) => {
      String(chunk).trim().split("\n").filter(Boolean).forEach((line) => {
        const message = JSON.parse(line) as Record<string, unknown>;
        outbound.push(message);
        if (message.method === "initialize") {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: "test" } })}\n`);
        }
      });
    });
    const client = new AppServerClient({
      executable: "codex-test",
      spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
    });
    const notifications: unknown[] = [];
    client.on("notification", (notification) => notifications.push(notification));

    await client.start();
    expect(outbound[0]).toMatchObject({ method: "initialize" });
    expect(outbound[0]).toMatchObject({
      params: {
        capabilities: { optOutNotificationMethods: ["item/reasoning/textDelta"] },
      },
    });
    expect(outbound[1]).toMatchObject({ method: "initialized" });

    const line = JSON.stringify({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", delta: "Szia" },
    });
    child.stdout.write(line.slice(0, 20));
    expect(notifications).toHaveLength(0);
    child.stdout.write(`${line.slice(20)}\n`);
    expect(notifications).toHaveLength(1);
    client.respondToServerRequest("approval-1", { decision: "decline" });
    client.respondToServerRequestError("tool-1", -32601, "unsupported");
    expect(outbound.at(-2)).toEqual({ id: "approval-1", result: { decision: "decline" } });
    expect(outbound.at(-1)).toEqual({
      id: "tool-1",
      error: { code: -32601, message: "unsupported" },
    });
    client.stop();
  });

  it("projects current thread responses and bounds reconnect delay", () => {
    const snapshot = toThreadSnapshot({
      id: "thread-1",
      name: "Feladat",
      status: { type: "active" },
      turns: [
        { id: "turn-1", status: "completed" },
        {
          id: "turn-2",
          status: "inProgress",
          items: [
            { id: "reasoning-1", type: "reasoning", content: ["private"] },
            { id: "agent-1", type: "agentMessage", text: "Készül" },
          ],
        },
      ],
    }, "fallback");
    expect(snapshot).toMatchObject({
      threadId: "thread-1",
      name: "Feladat",
      activeTurnId: "turn-2",
      status: "active",
    });
    expect(JSON.stringify(snapshot.raw)).not.toContain("private");
    expect(JSON.stringify(snapshot.raw)).toContain("Készül");
    expect(reconnectDelayMs(1, 100, 500)).toBe(100);
    expect(reconnectDelayMs(8, 100, 500)).toBe(500);
  });

  it("uses searchable thread pages, the model catalog, and the v2 thread and turn start methods", async () => {
    const child = fakeChild();
    const outbound: Array<Record<string, unknown>> = [];
    child.stdin.on("data", (chunk) => {
      String(chunk).trim().split("\n").filter(Boolean).forEach((line) => {
        const message = JSON.parse(line) as Record<string, unknown>;
        outbound.push(message);
        const method = message.method;
        if (method === "initialized") return;
        const result = method === "initialize"
          ? { userAgent: "test" }
          : method === "thread/list"
            ? { data: [], nextCursor: "next-thread" }
            : method === "model/list"
              ? {
                  data: [{
                    id: "model-1",
                    displayName: "Model One",
                    description: "Test model",
                    defaultReasoningEffort: "medium",
                    supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }],
                    isDefault: true,
                  }],
                  nextCursor: null,
                }
              : method === "thread/start"
                ? { thread: { id: "thread-new", status: { type: "idle" }, turns: [] } }
                : method === "thread/unsubscribe"
                  ? { status: "unsubscribed" }
                : method === "turn/start"
                  ? { turn: { id: "turn-new" } }
                  : {};
        child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
      });
    });
    const client = new AppServerClient({
      executable: "codex-test",
      spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
    });
    await client.start();

    expect(await client.listThreads({ searchTerm: "flotta", limit: 25 })).toEqual({
      threads: [],
      nextCursor: "next-thread",
    });
    expect(await client.listModels()).toMatchObject({
      models: [{ id: "model-1", defaultReasoningEffort: "medium", isDefault: true }],
    });
    const created = await client.createThread({
      model: "model-1",
      effort: "medium",
      cwd: "C:/project",
      message: "Kezdés",
    });
    expect(created.threadId).toBe("thread-new");
    expect(await client.startTurn("thread-new", "Kezdés", {
      model: "model-1",
      effort: "medium",
    })).toBe("turn-new");
    await client.unsubscribeThread("thread-new");
    expect(outbound.find((message) => message.method === "thread/list")).toMatchObject({
      params: { limit: 25, searchTerm: "flotta" },
    });
    expect(outbound.find((message) => message.method === "thread/start")).toMatchObject({
      params: { model: "model-1", cwd: "C:/project", serviceName: "synaius-operai" },
    });
    expect(outbound.find((message) => message.method === "turn/start")).toMatchObject({
      params: { threadId: "thread-new", model: "model-1", effort: "medium" },
    });
    expect(outbound.find((message) => message.method === "thread/unsubscribe")).toMatchObject({
      params: { threadId: "thread-new" },
    });
    client.stop();
  });
});

function fakeChild() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill() {
      Object.defineProperty(child, "killed", { configurable: true, value: true });
      child.emit("exit", 0, null);
      return true;
    },
  });
  return child;
}
