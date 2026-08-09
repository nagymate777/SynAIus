import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppServerClient,
  createThreadStreamHttpServer,
  ThreadEventStore,
  ThreadStreamService,
} from "@synaius/module-thread-stream/server";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const databasePath = process.env.SYNAIUS_THREAD_STREAM_DATABASE
  ?? join(repositoryRoot, "data", "operai-thread-stream.sqlite");
const host = process.env.SYNAIUS_BRIDGE_HOST ?? "127.0.0.1";
const port = optionalPort(process.env.SYNAIUS_BRIDGE_PORT, 4311);

mkdirSync(dirname(databasePath), { recursive: true });
const store = new ThreadEventStore(databasePath);
const client = new AppServerClient();
const service = new ThreadStreamService({ store, client });
const http = createThreadStreamHttpServer({ service, host, port });

await service.start();
const address = await http.listen();
process.stdout.write(`operai-bridge listening host=${address.host} port=${address.port}\n`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await http.close();
  service.close();
}

process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

function optionalPort(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : fallback;
}
