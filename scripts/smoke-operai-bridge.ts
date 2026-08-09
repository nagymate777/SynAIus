import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppServerClient,
  createThreadStreamHttpServer,
  ThreadEventStore,
  ThreadStreamService,
} from "@synaius/module-thread-stream/server";

const directory = mkdtempSync(join(tmpdir(), "synaius-operai-smoke-"));
const store = new ThreadEventStore(join(directory, "events.sqlite"));
const service = new ThreadStreamService({ store, client: new AppServerClient() });
const http = createThreadStreamHttpServer({ service, port: 0 });

try {
  await service.start();
  const address = await http.listen();
  const origin = `http://${address.host}:${address.port}`;
  const health = await fetch(`${origin}/healthz`).then((response) => response.json());
  const threads = await fetch(`${origin}/api/thread-stream/threads?limit=3`)
    .then(async (response) => ({ status: response.status, body: await response.json() }));
  process.stdout.write(`${JSON.stringify({ health, threads })}\n`);
} finally {
  await http.close();
  service.close();
  rmSync(directory, { recursive: true, force: true });
}
