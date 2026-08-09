import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  DurableThreadEvent,
  ServerRequestId,
  ThreadInteractionResponse,
} from "@synaius/protocol";
import type { ThreadStreamService } from "./service.ts";

export interface ThreadStreamHttpServerOptions {
  service: ThreadStreamService;
  host?: string;
  port?: number;
  additionalRoute?: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => boolean | Promise<boolean>;
}

export function createThreadStreamHttpServer(options: ThreadStreamHttpServerOptions) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4311;
  const server = createServer((request, response) => {
    void route(options.service, request, response, options.additionalRoute).catch((error) => {
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
  additionalRoute?: ThreadStreamHttpServerOptions["additionalRoute"],
) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/healthz") {
    return writeJson(response, 200, service.status());
  }
  if (request.method === "GET" && url.pathname === "/api/thread-stream/threads") {
    const cursor = url.searchParams.get("cursor");
    const limit = boundedInteger(url.searchParams.get("limit"), 50, 1, 100);
    const searchTerm = url.searchParams.get("searchTerm");
    return writeJson(response, 200, await service.listThreads({ cursor, limit, searchTerm }));
  }
  if (request.method === "GET" && url.pathname === "/api/thread-stream/models") {
    const cursor = url.searchParams.get("cursor");
    const limit = boundedInteger(url.searchParams.get("limit"), 100, 1, 100);
    return writeJson(response, 200, await service.listModels(cursor, limit));
  }
  if (request.method === "POST" && url.pathname === "/api/thread-stream/threads") {
    const body = await readJsonBody(request);
    return writeJson(response, 201, await service.createThread({
      model: requiredString(body.model, "thread-stream.model.required"),
      effort: optionalString(body.effort),
      cwd: optionalString(body.cwd),
      message: requiredString(body.message, "thread-stream.message.required"),
    }));
  }

  const threadPath = url.pathname.match(/^\/api\/thread-stream\/threads\/([^/]+)$/);
  if (request.method === "GET" && threadPath) {
    return writeJson(response, 200, await service.readThread(decodeURIComponent(threadPath[1])));
  }

  const interactionsPath = url.pathname.match(
    /^\/api\/thread-stream\/threads\/([^/]+)\/interactions$/,
  );
  if (interactionsPath) {
    const threadId = decodeURIComponent(interactionsPath[1]);
    if (request.method === "GET") {
      return writeJson(response, 200, { interactions: service.listInteractions(threadId) });
    }
    if (request.method === "POST") {
      const body = await readJsonBody(request);
      await service.respondToInteraction(
        threadId,
        requiredRequestId(body.requestId),
        requiredRecord(
          body.response,
          "thread-stream.interaction.response.required",
        ) as unknown as ThreadInteractionResponse,
      );
      return writeJson(response, 200, { ok: true });
    }
  }

  const artifactPath = url.pathname.match(
    /^\/api\/thread-stream\/threads\/([^/]+)\/artifacts\/file$/,
  );
  if (request.method === "GET" && artifactPath) {
    return writeJson(
      response,
      200,
      await service.readThreadFileArtifact(
        decodeURIComponent(artifactPath[1]),
        requiredString(url.searchParams.get("path"), "artifact.path.invalid"),
      ),
    );
  }

  const artifactIndexPath = url.pathname.match(
    /^\/api\/thread-stream\/threads\/([^/]+)\/artifacts$/,
  );
  if (request.method === "GET" && artifactIndexPath) {
    return writeJson(
      response,
      200,
      await service.listThreadFileArtifacts(decodeURIComponent(artifactIndexPath[1])),
    );
  }

  const actionPath = url.pathname.match(
    /^\/api\/thread-stream\/threads\/([^/]+)\/(attach|detach|resume|turns|steer|interrupt)$/,
  );
  if (request.method === "POST" && actionPath) {
    const threadId = decodeURIComponent(actionPath[1]);
    if (actionPath[2] === "attach") return writeJson(response, 200, await service.attachThread(threadId));
    if (actionPath[2] === "resume") return writeJson(response, 200, await service.resumeThread(threadId));
    const body = await readJsonBody(request);
    if (actionPath[2] === "detach") {
      await service.releaseAttachment(
        threadId,
        requiredString(body.attachmentId, "thread-stream.attachmentId.required"),
      );
      return writeJson(response, 200, { ok: true });
    }
    if (actionPath[2] === "turns") {
      await service.startTurn(
        threadId,
        requiredString(body.message, "thread-stream.message.required"),
      );
      return writeJson(response, 201, { ok: true });
    }
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
    const attachmentId = requiredString(
      url.searchParams.get("attachmentId"),
      "thread-stream.attachmentId.required",
    );
    if (!service.hasAttachment(decodeURIComponent(streamPath[1]), attachmentId)) {
      throw Object.assign(new Error("thread-stream.attachment.invalid"), { statusCode: 404 });
    }
    return streamThread(
      service,
      decodeURIComponent(streamPath[1]),
      request,
      response,
      url.searchParams.get("after"),
    );
  }

  if (additionalRoute && await additionalRoute(request, response)) return;
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

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredRequestId(value: unknown): ServerRequestId {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("thread-stream.interaction.requestId.required");
  }
  return value;
}

function requiredRecord(value: unknown, code: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
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
