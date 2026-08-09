import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspace, type WorkspaceCommand } from "@synaius/domain";
import {
  createWorkspaceControlHttpHandler,
  WorkspaceControlService,
  WorkspaceControlStore,
} from "@synaius/workspace-control/server";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("workspace control service", () => {
  it("persists commands before broadcast and handles idempotent retries", () => {
    const { service, databasePath } = createService();
    const workspace = testWorkspace();
    expect(service.initialize(workspace)).toMatchObject({ workspace: { revision: 0 }, latestCursor: null });
    let persistedBeforeBroadcast = false;
    let broadcasts = 0;
    service.subscribe(workspace.id, (event) => {
      broadcasts += 1;
      persistedBeforeBroadcast = service.eventsAfter(workspace.id)
        .some((stored) => stored.cursor === event.cursor);
    });
    const command = createBoxCommand(0, "command-1", "box-1");
    const first = service.execute(workspace.id, command);
    const retried = service.execute(workspace.id, command);
    expect(persistedBeforeBroadcast).toBe(true);
    expect(broadcasts).toBe(1);
    expect(first.event.cursor).toBe(retried.event.cursor);
    expect(service.eventsAfter(workspace.id)).toHaveLength(1);
    expect(service.read(workspace.id).workspace.boxes["box-1"]).toBeDefined();
    service.close();

    const reopened = new WorkspaceControlService(new WorkspaceControlStore(databasePath));
    expect(reopened.read(workspace.id)).toMatchObject({
      workspace: { revision: 1, boxes: { "box-1": { name: "Doboz box-1" } } },
      latestCursor: first.event.cursor,
    });
    reopened.close();
  });

  it("rejects stale revisions and malformed initial snapshots", () => {
    const { service } = createService();
    const workspace = testWorkspace();
    service.initialize(workspace);
    service.execute(workspace.id, createBoxCommand(0, "command-1", "box-1"));
    expect(() => service.execute(
      workspace.id,
      createBoxCommand(0, "command-2", "box-2"),
    )).toThrowError("workspace.revision.conflict");
    expect(() => service.initialize({ ...workspace, activeViewId: "missing" }))
      .toThrowError("workspace-control.workspace.invalid");
    service.close();
  });

  it("serves snapshots, commands and replayable SSE on the shared HTTP surface", async () => {
    const { service } = createService();
    const handler = createWorkspaceControlHttpHandler(service);
    const server = createServer((request, response) => {
      void handler(request, response).then((handled) => {
        if (!handled) {
          response.writeHead(404).end();
        }
      }).catch((error) => {
        response.writeHead((error as { statusCode?: number }).statusCode ?? 500, {
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const workspace = testWorkspace();
    const workspacePath = `/api/workspace-control/workspaces/${workspace.id}`;
    const initialized = await fetch(`${origin}${workspacePath}/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace }),
    });
    expect(initialized.status).toBe(200);
    const command = createBoxCommand(0, "command-http", "box-http");
    const executed = await fetch(`${origin}${workspacePath}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    expect(executed.status).toBe(200);
    expect(await executed.json()).toMatchObject({ workspace: { revision: 1 } });

    const controller = new AbortController();
    const streamed = await fetch(`${origin}${workspacePath}/stream?after=0`, {
      signal: controller.signal,
    });
    expect(streamed.status).toBe(200);
    const reader = streamed.body!.getReader();
    let body = "";
    while (!body.includes("event: workspace-event")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += new TextDecoder().decode(chunk.value);
    }
    expect(body).toContain("id: 1");
    expect(body).toContain('"command-http"');
    controller.abort();
    await reader.cancel().catch(() => undefined);

    const liveController = new AbortController();
    const liveStream = await fetch(`${origin}${workspacePath}/stream?after=1`, {
      signal: liveController.signal,
    });
    const liveReader = liveStream.body!.getReader();
    const liveCommand = createBoxCommand(1, "command-http-live", "box-http-live");
    const liveExecuted = await fetch(`${origin}${workspacePath}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: liveCommand }),
    });
    expect(liveExecuted.status).toBe(200);
    let liveBody = "";
    while (!liveBody.includes("command-http-live")) {
      const chunk = await liveReader.read();
      if (chunk.done) break;
      liveBody += new TextDecoder().decode(chunk.value);
    }
    expect(liveBody).toContain("event: workspace-event");
    expect(liveBody).toContain('"command-http-live"');
    liveController.abort();
    await liveReader.cancel().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    service.close();
  });
});

function createService() {
  const directory = mkdtempSync(join(tmpdir(), "synaius-workspace-control-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "workspace.sqlite");
  return {
    databasePath,
    service: new WorkspaceControlService(new WorkspaceControlStore(databasePath)),
  };
}

function testWorkspace() {
  return createWorkspace({
    workspaceId: "workspace-control-test",
    initialViewId: "main",
    initialViewName: "Alapnézet",
  });
}

function createBoxCommand(
  expectedRevision: number,
  id: string,
  boxId: string,
): WorkspaceCommand {
  return {
    id,
    expectedRevision,
    type: "box.create",
    payload: {
      boxId,
      viewId: "main",
      parentId: null,
      name: `Doboz ${boxId}`,
      rect: { column: 0, row: 4, width: 6, height: 4 },
    },
  };
}
