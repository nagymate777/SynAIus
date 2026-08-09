import { describe, expect, it } from "vitest";
import { createWorkspace, type WorkspaceCommand } from "@synaius/domain";
import {
  BrowserWorkspaceControlGateway,
  type WorkspaceEventSourceLike,
} from "@synaius/workspace-control/client";
import type { DurableWorkspaceEvent } from "@synaius/workspace-control";

describe("browser workspace control gateway", () => {
  it("initializes, resumes from the durable cursor and sends commands", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const source = new FakeEventSource();
    const workspace = createWorkspace({
      workspaceId: "workspace/1",
      initialViewId: "main",
      initialViewName: "Alapnézet",
    });
    const gateway = new BrowserWorkspaceControlGateway({
      baseUrl: "/bridge",
      fetchImplementation: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        const command = init?.body
          ? (JSON.parse(String(init.body)) as { command?: WorkspaceCommand }).command
          : null;
        const body = command
          ? {
              workspace: { ...workspace, revision: 1 },
              latestCursor: "13",
              event: workspaceEvent(command, "13"),
            }
          : { workspace, latestCursor: "12" };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
      eventSourceFactory: (url) => {
        source.url = url;
        return source;
      },
    });
    const events: DurableWorkspaceEvent[] = [];
    const connected = await gateway.connect(workspace, (event) => events.push(event));
    expect(connected.latestCursor).toBe("12");
    expect(requests[0].url).toBe("/bridge/workspaces/workspace%2F1/initialize");
    expect(source.url).toBe("/bridge/workspaces/workspace%2F1/stream?after=12");

    const command: WorkspaceCommand = {
      id: "command-1",
      expectedRevision: 0,
      type: "workspace.names.set",
      payload: { visible: false },
    };
    const event = workspaceEvent(command, "13");
    source.dispatch("workspace-event", JSON.stringify(event));
    expect(events).toEqual([event]);
    expect((await gateway.execute(workspace.id, command)).event.cursor).toBe("13");
    expect(requests[1].url).toBe("/bridge/workspaces/workspace%2F1/commands");
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({ command });
    gateway.close();
    expect(source.closed).toBe(true);
  });

  it("binds the native fetch implementation to its global owner", async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown = null;
    globalThis.fetch = (async function (this: unknown) {
      receiver = this;
      return new Response(JSON.stringify({ workspace: createWorkspace({
        workspaceId: "workspace",
        initialViewId: "main",
        initialViewName: "Alapnézet",
      }), latestCursor: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const gateway = new BrowserWorkspaceControlGateway();
      await gateway.read("workspace");
      expect(receiver).toBe(globalThis);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

class FakeEventSource implements WorkspaceEventSourceLike {
  url = "";
  closed = false;
  private readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, listener);
  }

  close() {
    this.closed = true;
  }

  dispatch(type: string, data: string) {
    this.listeners.get(type)?.({ data } as MessageEvent<string>);
  }
}

function workspaceEvent(command: WorkspaceCommand, cursor: string): DurableWorkspaceEvent {
  return {
    cursor,
    workspaceId: "workspace/1",
    revision: 1,
    command,
    occurredAt: "2026-08-09T20:00:00.000Z",
  };
}
