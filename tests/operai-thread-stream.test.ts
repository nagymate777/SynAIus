import { describe, expect, it } from "vitest";
import { createWorkspace } from "@synaius/domain";
import {
  projectThreadEvent,
  projectThreadInteractions,
  projectThreadSnapshot,
} from "@synaius/module-thread-stream/renderer";
import type { DurableThreadEvent, PendingThreadInteraction, ThreadSnapshot } from "@synaius/protocol";
import {
  initializeOperaiWorkspace,
  OPERAI_THREAD_STREAM_BOX_ID,
  OPERAI_THREAD_STREAM_CONTENT_ID,
} from "../apps/operai/src/workspace";

describe("OperAI thread-stream composition", () => {
  it("adds its initial module content exactly once", () => {
    const initial = createWorkspace({
      workspaceId: "operai",
      initialViewId: "main",
      initialViewName: "OperAI",
    });
    const initialized = initializeOperaiWorkspace(initial);
    const repeated = initializeOperaiWorkspace(initialized);
    expect(initialized.contents[OPERAI_THREAD_STREAM_CONTENT_ID]).toMatchObject({
      type: "module.thread-stream.viewer",
      configuration: { threadId: null },
    });
    expect(initialized.boxes[OPERAI_THREAD_STREAM_BOX_ID]).toMatchObject({
      contentId: OPERAI_THREAD_STREAM_CONTENT_ID,
      viewId: "main",
    });
    expect(repeated).toBe(initialized);
  });

  it("projects existing messages and merges live agent deltas", () => {
    const snapshot: ThreadSnapshot = {
      threadId: "thread-1",
      cursor: "2",
      activeTurnId: "turn-1",
      name: null,
      status: "active",
      accessMode: "interactive",
      raw: {
        turns: [{
          items: [
            { id: "user-1", type: "userMessage", content: [{ type: "text", text: "Kezdjük" }] },
            { id: "agent-1", type: "agentMessage", text: "Rendben" },
          ],
        }],
      },
    };
    const initial = projectThreadSnapshot(snapshot);
    const delta = event("3", "item/agentMessage/delta", { itemId: "agent-1", delta: ", mehet." });
    expect(projectThreadEvent(initial, delta)).toEqual([
      { id: "user-1", kind: "user", text: "Kezdjük" },
      { id: "agent-1", kind: "agent", text: "Rendben, mehet." },
    ]);
  });

  it("adds and resolves scoped workbox interactions from durable events", () => {
    const interaction: PendingThreadInteraction = {
      requestId: 42,
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      createdAt: "2026-08-09T10:00:00.000Z",
      kind: "commandApproval",
      reason: null,
      command: "tool --check",
      cwd: "C:/project",
      networkHost: null,
      networkProtocol: null,
    };
    const requested = event("4", "gateway/interactionRequested", { interaction });
    const pending = projectThreadInteractions([], requested);
    expect(pending).toEqual([interaction]);
    const resolved = event("5", "serverRequest/resolved", { requestId: 42 });
    expect(projectThreadInteractions(pending, resolved)).toEqual([]);
  });

  it("projects command output and the authoritative completed command item", () => {
    const started = event("10", "item/started", {
      item: {
        id: "command-1",
        type: "commandExecution",
        command: "npm test",
        cwd: "C:/project",
        status: "inProgress",
        aggregatedOutput: null,
        exitCode: null,
        durationMs: null,
      },
    });
    const output = event("11", "item/commandExecution/outputDelta", {
      itemId: "command-1",
      delta: "tesztek futnak\n",
    });
    const completed = event("12", "item/completed", {
      item: {
        id: "command-1",
        type: "commandExecution",
        command: "npm test",
        cwd: "C:/project",
        status: "completed",
        aggregatedOutput: "tesztek futnak\n66 sikeres\n",
        exitCode: 0,
        durationMs: 2300,
      },
    });

    const live = projectThreadEvent(projectThreadEvent([], started), output);
    expect(live[0]).toMatchObject({
      kind: "activity",
      activity: { kind: "command", status: "inProgress", output: "tesztek futnak\n" },
    });
    expect(projectThreadEvent(live, completed)[0]).toMatchObject({
      kind: "activity",
      activity: {
        kind: "command",
        status: "completed",
        output: "tesztek futnak\n66 sikeres\n",
        exitCode: 0,
        durationMs: 2300,
      },
    });
  });

  it("keeps file diffs and MCP progress in the durable activity projection", () => {
    const fileStarted = event("20", "item/started", {
      item: {
        id: "file-1",
        type: "fileChange",
        status: "inProgress",
        changes: [{ path: "src/app.ts", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new" }],
      },
    });
    const diffUpdated = event("21", "turn/diff/updated", {
      turnId: "turn-1",
      diff: "diff --git a/src/app.ts b/src/app.ts",
    });
    const mcpStarted = event("22", "item/started", {
      item: {
        id: "mcp-1",
        type: "mcpToolCall",
        server: "home-assistant",
        tool: "read_state",
        status: "inProgress",
        arguments: { entity: "light.room" },
        result: null,
        error: null,
        durationMs: null,
      },
    });
    const progress = event("23", "item/mcpToolCall/progress", {
      itemId: "mcp-1",
      message: "Kapcsolódás",
    });
    const mcpCompleted = event("24", "item/completed", {
      item: {
        id: "mcp-1",
        type: "mcpToolCall",
        server: "home-assistant",
        tool: "read_state",
        status: "completed",
        arguments: { entity: "light.room" },
        result: { structuredContent: { state: "on" } },
        error: null,
        durationMs: 15,
      },
    });
    const turnCompleted = event("25", "turn/completed", {
      turn: { id: "turn-1", status: "completed", items: [] },
    });

    const projected = [fileStarted, diffUpdated, mcpStarted, progress, mcpCompleted, turnCompleted]
      .reduce(projectThreadEvent, []);
    expect(projected).toHaveLength(3);
    expect(projected[0]).toMatchObject({
      activity: {
        kind: "fileChange",
        changes: [{ path: "src/app.ts", kind: "update" }],
      },
    });
    expect(projected[1]).toMatchObject({
      activity: { kind: "turnDiff", status: "completed" },
    });
    expect(projected[2]).toMatchObject({
      activity: {
        kind: "mcpTool",
        status: "completed",
        progress: ["Kapcsolódás"],
        durationMs: 15,
      },
    });
    expect((projected[2] as { activity: { resultPreview: string } }).activity.resultPreview)
      .toContain("state");
  });

  it("projects completed activity history from a bounded thread snapshot", () => {
    const snapshot: ThreadSnapshot = {
      threadId: "thread-1",
      cursor: "30",
      activeTurnId: null,
      name: null,
      status: "idle",
      accessMode: "interactive",
      raw: {
        turns: [{
          id: "turn-1",
          items: [{
            id: "dynamic-1",
            type: "dynamicToolCall",
            namespace: "portal",
            tool: "refresh",
            status: "completed",
            argumentsPreview: "{\"force\":true}",
            resultPreview: "[{\"type\":\"inputText\"}]",
            success: true,
            durationMs: 50,
          }],
        }],
      },
    };
    expect(projectThreadSnapshot(snapshot)).toEqual([{
      id: "dynamic-1",
      kind: "activity",
      activity: {
        id: "dynamic-1",
        turnId: "turn-1",
        kind: "dynamicTool",
        status: "completed",
        namespace: "portal",
        tool: "refresh",
        argumentsPreview: "{\"force\":true}",
        resultPreview: "[{\"type\":\"inputText\"}]",
        success: true,
        durationMs: 50,
      },
    }]);
  });
});

function event(cursor: string, method: string, params: unknown): DurableThreadEvent {
  return {
    cursor,
    threadId: "thread-1",
    turnId: "turn-1",
    method,
    source: "app-server",
    connectionId: "connection-1",
    receivedAt: "2026-08-09T10:00:00.000Z",
    raw: { method, params },
  };
}
