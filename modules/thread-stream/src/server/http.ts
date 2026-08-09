import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { DurableThreadEvent } from "@synaius/protocol";
import type { ThreadStreamService } from "./service.ts";

export interface ThreadStreamHttpServerOptions {
  service: ThreadStreamService;
  host?: string;
  port?: number;
}

export function createThreadStreamHttpServer(options: ThreadStreamHttpServerOptions) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4311;
  const server = createServer((request, response) => {
    void route(options.service, request, response).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      writeJson(response, statusForError(error), {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  return {
    server,
    listen() {
      return new Promise<{ host: string; port: number }>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          resolve({ host, port: typeof address === "object" && address ? address.port : port });
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}

async function route(
  service: ThreadStreamService,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/healthz") {
    return writeJson(response, 200, service.status());
  }
  if (request.method === "GET" && url.pathname === "/api/thread-stream/threads") {
    const cursor = url.searchParams.get("cursor");
    const limit = boundedInteger(url.searchParams.get("limit"), 50, 1, 100);
    return writeJson(response, 200, await service.listThreads(cursor, limit));
  }

  const threadPath = url.pathname.match(/^\/api\/thread-stream\/threads\/([^/]+)$/);
  if (request.method === "GET" && threadPath) {
    return writeJson(response, 200, await service.readThread(decodeURIComponent(threadPath[1])));
  }

  const actionPath = url.pathname.match(
    /^\/api\/thread-stream\/threads\/([^/]+)\/(attach|resume|steer|interrupt)$/,
  );
  if (request.method === "POST" && actionPath) {
    const threadId = decodeURIComponent(actionPath[1]);
    if (actionPath[2] === "attach") return writeJson(response, 200, await service.attachThread(threadId));
    if (actionPath[2] === "resume") return writeJson(response, 200, await service.resumeThread(threadId));
    const body = await readJsonBody(request);
    const turnId = requiredString(body.turnId, "thread-stream.turnId.required");
    if (actionPath[2] === "steer") {
      await service.steerTurn(
        threadId,
        turnId,
        requiredString(body.message, "thread-stream.message.required"),
      );
    } else {
      await service.interruptTurn(threadId, turnId);
    }
    return writeJson(response, 200, { ok: true });
  }

  const historyPath = url.pathname.match(/^\/api\/thread-stream\/threads\/([^/]+)\/events$/);
  if (request.method === "GET" && historyPath) {
    const threadId = decodeURIComponent(historyPath[1]);
    const after = url.searchParams.get("after");
    const limit = boundedInteger(url.searchParams.get("limit"), 500, 1, 2_000);
    return writeJson(response, 200, {
      events: service.eventsAfter(threadId, after, limit),
      latestCursor: service.latestCursor(threadId),
    });
  }

  const streamPath = url.pathname.match(/^\/api\/thread-stream\/threads\/([^/]+)\/stream$/);
  if (request.method === "GET" && streamPath) {
    return streamThread(
      service,
      decodeURIComponent(streamPath[1]),
      request,
      response,
      url.searchParams.get("after"),
    );
  }

  writeJson(response, 404, { error: "thread-stream.route.notFound" });
}

function streamThread(
  service: ThreadStreamService,
  threadId: string,
  request: IncomingMessage,
  response: ServerResponse,
  queryCursor: string | null,
) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write("retry: 2000\n\n");
  const after = headerValue(request.headers["last-event-id"]) ?? queryCursor;
  const buffered: DurableThreadEvent[] = [];
  let live = false;
  const unsubscribe = service.subscribe(threadId, (event) => {
    if (live) writeSseEvent(response, event);
    else buffered.push(event);
  });
  const highWater = service.latestCursor(threadId);
  let cursor = after;
  while (true) {
    const page = service.eventsAfter(threadId, cursor, 500, highWater);
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
  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function writeSseEvent(response: ServerResponse, event: DurableThreadEvent) {
  response.write(`id: ${event.cursor}\nevent: thread-event\ndata: ${JSON.stringify(event)}\n\n`);
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
    if (length > 1_000_000) throw Object.assign(new Error("thread-stream.body.tooLarge"), { statusCode: 413 });
    chunks.push(buffer);
  }
  if (!chunks.length) return {} as Record<string, unknown>;
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("thread-stream.body.invalid");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, code: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? null;
}

function statusForError(error: unknown) {
  const status = (error as { statusCode?: unknown })?.statusCode;
  if (typeof status === "number") return status;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("disconnected")) return 503;
  if (message.includes("required") || message.includes("invalid")) return 400;
  return 500;
}
