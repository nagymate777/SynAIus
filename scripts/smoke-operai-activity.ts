import { AppServerClient } from "@synaius/module-thread-stream/server";

const EXPECTED_OUTPUT = "SYNAIUS_ACTIVITY_OUTPUT";
const client = new AppServerClient({ requestTimeoutMs: 90_000 });
let commandStarted = false;
let commandCompleted = false;
let commandOutput = "";

try {
  await client.start();
  const catalog = await client.listModels(null, 100);
  const model = catalog.models.find((candidate) => candidate.isDefault) ?? catalog.models[0];
  if (!model) throw new Error("thread-stream.smoke.model.missing");

  const started = await client.request<{ thread?: { id?: string } }>("thread/start", {
    model: model.id,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    serviceName: "synaius-operai-activity-smoke",
  });
  const threadId = started.thread?.id;
  if (!threadId) throw new Error("thread-stream.smoke.thread.missing");

  const completion = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("thread-stream.smoke.activity.timeout")),
      90_000,
    );
    client.on("serverRequest", ({ message }) => {
      const request = record(message);
      const params = record(request.params);
      const requestId = request.id;
      if (params.threadId !== threadId
        || (typeof requestId !== "string" && typeof requestId !== "number")) return;
      client.respondToServerRequestError(requestId, -32601, "thread-stream.smoke.unexpectedRequest");
    });
    client.on("notification", ({ notification }) => {
      const params = record(notification.params);
      if (params.threadId !== threadId) return;
      if (notification.method === "item/started") {
        const item = record(params.item);
        if (item.type === "commandExecution") commandStarted = true;
        return;
      }
      if (notification.method === "item/commandExecution/outputDelta") {
        commandOutput += typeof params.delta === "string" ? params.delta : "";
        return;
      }
      if (notification.method === "item/completed") {
        const item = record(params.item);
        if (item.type !== "commandExecution") return;
        commandCompleted = item.status === "completed";
        if (typeof item.aggregatedOutput === "string") commandOutput = item.aggregatedOutput;
        return;
      }
      if (notification.method !== "turn/completed") return;
      clearTimeout(timer);
      resolve();
    });
  });

  await client.startTurn(
    threadId,
    `A válasz előtt futtasd a shell eszközzel a Write-Output ${EXPECTED_OUTPUT} parancsot. Ne helyettesítsd szöveges válasszal.`,
    { model: model.id, effort: model.defaultReasoningEffort },
  );
  await completion;
  if (!commandStarted) throw new Error("thread-stream.smoke.activity.commandStart.missing");
  if (!commandCompleted) throw new Error("thread-stream.smoke.activity.commandCompletion.missing");
  if (!commandOutput.includes(EXPECTED_OUTPUT)) {
    throw new Error("thread-stream.smoke.activity.commandOutput.invalid");
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    model: model.id,
    commandStarted,
    commandCompleted,
    outputObserved: true,
  })}\n`);
} finally {
  client.stop();
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
