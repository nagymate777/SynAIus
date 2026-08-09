import type { IncomingMessage, ServerResponse } from "node:http";
import type { DurableWorkspaceEvent } from "../index.ts";
import type { WorkspaceControlService } from "./service.ts";

export function createWorkspaceControlHttpHandler(service: WorkspaceControlService) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/workspace-control/healthz") {
      writeJson(response, 200, service.status());
      return true;
    }

    const workspacePath = url.pathname.match(/^\/api\/workspace-control\/workspaces\/([^/]+)$/);
    if (request.method === "GET" && workspacePath) {
      writeJson(response, 200, service.read(decodeURIComponent(workspacePath[1])));
      return true;
    }

    const initializePath = url.pathname.match(
      /^\/api\/workspace-control\/workspaces\/([^/]+)\/initialize$/,
    );
    if (request.method === "POST" && initializePath) {
      const workspaceId = decodeURIComponent(initializePath[1]);
      const body = await readJsonBody(request);
      const workspace = body.workspace as never;
      if ((workspace as { id?: unknown } | null)?.id !== workspaceId) {
        throw statusError("workspace-control.workspace.idMismatch", 400);
      }
      writeJson(response, 200, service.initialize(workspace));
      return true;
    }

    const commandPath = url.pathname.match(
      /^\/api\/workspace-control\/workspaces\/([^/]+)\/commands$/,
    );
    if (request.method === "POST" && commandPath) {
      const body = await readJsonBody(request);
      writeJson(response, 200, service.execute(
        decodeURIComponent(commandPath[1]),
        body.command as never,
      ));
      return true;
    }

    const eventsPath = url.pathname.match(
      /^\/api\/workspace-control\/workspaces\/([^/]+)\/events$/,
    );
    if (request.method === "GET" && eventsPath) {
      const workspaceId = decodeURIComponent(eventsPath[1]);
      const limit = boundedInteger(url.searchParams.get("limit"), 500, 1, 2_000);
      writeJson(response, 200, {
        events: service.eventsAfter(workspaceId, url.searchParams.get("after"), limit),
        latestCursor: service.latestCursor(workspaceId),
      });
      return true;
    }

    const streamPath = url.pathname.match(
      /^\/api\/workspace-control\/workspaces\/([^/]+)\/stream$/,
    );
    if (request.method === "GET" && streamPath) {
      streamWorkspace(
        service,
        decodeURIComponent(streamPath[1]),
        request,
        response,
        url.searchParams.get("after"),
      );
      return true;
    }
    return false;
  };
}

function streamWorkspace(
  service: WorkspaceControlService,
  workspaceId: string,
  request: IncomingMessage,
  response: ServerResponse,
  queryCursor: string | null,
) {
  service.read(workspaceId);
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write("retry: 2000\n\n");
  const after = headerValue(request.headers["last-event-id"]) ?? queryCursor;
  const buffered: DurableWorkspaceEvent[] = [];
  let live = false;
  const unsubscribe = service.subscribe(workspaceId, (event) => {
    if (live) writeSseEvent(response, event);
    else buffered.push(event);
  });
  const highWater = service.latestCursor(workspaceId);
  let cursor = after;
  while (true) {
    const page = service.eventsAfter(workspaceId, cursor, 500, highWater);
    if (!page.length) break;
    page.forEach((event) => writeSseEvent(response, event));
    cursor = page.at(-1)!.cursor;
    if (page.length < 500) break;
  }
  live = true;
  const highWaterNumber = Number(highWater ?? 0);
  buffered
    .filter((event) => Number(event.cursor) > highWaterNumber)
    .sort((left, right) => Number(left.cursor) - Number(right.cursor))
    .forEach((event) => writeSseEvent(response, event));

  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  response.on("close", close);
  request.on("aborted", close);
}

function writeSseEvent(response: ServerResponse, event: DurableWorkspaceEvent) {
  response.write(`id: ${event.cursor}\nevent: workspace-event\ndata: ${JSON.stringify(event)}\n\n`);
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 5_000_000) throw statusError("workspace-control.body.tooLarge", 413);
    chunks.push(buffer);
  }
  if (!chunks.length) return {} as Record<string, unknown>;
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw statusError("workspace-control.body.invalid", 400);
  }
  return parsed as Record<string, unknown>;
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? null;
}

function statusError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
