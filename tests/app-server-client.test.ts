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
