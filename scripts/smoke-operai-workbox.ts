import { AppServerClient } from "@synaius/module-thread-stream/server";

const EXPECTED = "SYNAIUS_E2E_OK";
const client = new AppServerClient({ requestTimeoutMs: 60_000 });

try {
  await client.start();
  const catalog = await client.listModels(null, 100);
  const model = catalog.models.find((candidate) => candidate.isDefault) ?? catalog.models[0];
  if (!model) throw new Error("thread-stream.smoke.model.missing");

  const started = await client.request<{ thread?: { id?: string } }>("thread/start", {
    model: model.id,
    ephemeral: true,
    serviceName: "synaius-operai-smoke",
  });
  const threadId = started.thread?.id;
  if (!threadId) throw new Error("thread-stream.smoke.thread.missing");

  let responseText = "";
  const completion = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("thread-stream.smoke.turn.timeout")),
      60_000,
    );
    client.on("notification", ({ notification }) => {
      const params = record(notification.params);
      if (params.threadId !== threadId) return;
      if (notification.method === "item/completed") {
        const item = record(params.item);
        if (item.type === "agentMessage" && typeof item.text === "string") {
          responseText += item.text;
        }
        return;
      }
      if (notification.method !== "turn/completed") return;
      clearTimeout(timer);
      resolve();
    });
  });

  await client.startTurn(
    threadId,
    `Válaszolj pontosan ezzel, minden más szöveg nélkül: ${EXPECTED}`,
    { model: model.id, effort: model.defaultReasoningEffort },
  );
  await completion;
  if (!responseText.includes(EXPECTED)) {
    throw new Error("thread-stream.smoke.response.invalid");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, model: model.id, ephemeral: true })}\n`);
} finally {
  client.stop();
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
