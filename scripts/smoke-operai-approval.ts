import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { AppServerClient } from "@synaius/module-thread-stream/server";

const client = new AppServerClient({ requestTimeoutMs: 90_000 });
const smokeFile = join(process.cwd(), "synaius-approval-smoke.tmp");
let approvalSeen = false;

if (existsSync(smokeFile)) throw new Error("thread-stream.smoke.file.alreadyExists");

try {
  await client.start();
  const catalog = await client.listModels(null, 100);
  const model = catalog.models.find((candidate) => candidate.isDefault) ?? catalog.models[0];
  if (!model) throw new Error("thread-stream.smoke.model.missing");

  const started = await client.request<{ thread?: { id?: string } }>("thread/start", {
    model: model.id,
    cwd: process.cwd(),
    approvalPolicy: "on-request",
    sandbox: "read-only",
    ephemeral: true,
    serviceName: "synaius-operai-approval-smoke",
  });
  const threadId = started.thread?.id;
  if (!threadId) throw new Error("thread-stream.smoke.thread.missing");

  const completion = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("thread-stream.smoke.approval.timeout")),
      90_000,
    );
    client.on("serverRequest", ({ message }) => {
      const request = record(message);
      const params = record(request.params);
      if (params.threadId !== threadId) return;
      const requestId = request.id;
      if (typeof requestId !== "string" && typeof requestId !== "number") return;
      if (request.method === "item/commandExecution/requestApproval"
        || request.method === "item/fileChange/requestApproval") {
        approvalSeen = true;
        client.respondToServerRequest(requestId, { decision: "decline" });
      } else {
        client.respondToServerRequestError(requestId, -32601, "thread-stream.smoke.unsupported");
      }
    });
    client.on("notification", ({ notification }) => {
      const params = record(notification.params);
      if (notification.method !== "turn/completed" || params.threadId !== threadId) return;
      clearTimeout(timer);
      resolve();
    });
  });

  await client.startTurn(
    threadId,
    "A válasz előtt a shell eszközzel próbálj létrehozni egy synaius-approval-smoke.tmp fájlt az aktuális munkamappában. Ne keress kerülőutat.",
    { model: model.id, effort: model.defaultReasoningEffort },
  );
  await completion;
  if (!approvalSeen) throw new Error("thread-stream.smoke.approval.missing");
  if (existsSync(smokeFile)) throw new Error("thread-stream.smoke.declinedWrite.executed");
  process.stdout.write(`${JSON.stringify({ ok: true, model: model.id, approval: "declined" })}\n`);
} finally {
  client.stop();
  if (existsSync(smokeFile)) unlinkSync(smokeFile);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
