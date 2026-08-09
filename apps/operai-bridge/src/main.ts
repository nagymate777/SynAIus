import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppServerClient,
  createThreadStreamHttpServer,
  ThreadEventStore,
  ThreadStreamService,
} from "@synaius/module-thread-stream/server";
import {
  createWorkspaceControlHttpHandler,
  WorkspaceControlService,
  WorkspaceControlStore,
} from "@synaius/workspace-control/server";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const databasePath = process.env.SYNAIUS_THREAD_STREAM_DATABASE
  ?? join(repositoryRoot, "data", "operai-thread-stream.sqlite");
const workspaceDatabasePath = process.env.SYNAIUS_WORKSPACE_CONTROL_DATABASE
  ?? join(repositoryRoot, "data", "operai-workspace-control.sqlite");
const host = process.env.SYNAIUS_BRIDGE_HOST ?? "127.0.0.1";
const port = optionalPort(process.env.SYNAIUS_BRIDGE_PORT, 4311);

mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(dirname(workspaceDatabasePath), { recursive: true });
const store = new ThreadEventStore(databasePath);
const client = new AppServerClient();
const service = new ThreadStreamService({ store, client });
const workspaceService = new WorkspaceControlService(
  new WorkspaceControlStore(workspaceDatabasePath),
);
const http = createThreadStreamHttpServer({
  service,
  host,
  port,
  additionalRoute: createWorkspaceControlHttpHandler(workspaceService),
});

await service.start();
const address = await http.listen();
process.stdout.write(`operai-bridge listening host=${address.host} port=${address.port}\n`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await http.close();
  service.close();
  workspaceService.close();
}

process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

function optionalPort(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : fallback;
}
