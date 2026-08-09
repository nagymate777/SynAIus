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
