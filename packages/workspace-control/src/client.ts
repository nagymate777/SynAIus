import type { WorkspaceCommand, WorkspaceState } from "@synaius/domain";
import type {
  DurableWorkspaceEvent,
  WorkspaceControlCommandResult,
  WorkspaceControlGateway,
  WorkspaceControlSnapshot,
} from "./index.ts";

export interface WorkspaceEventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export interface BrowserWorkspaceControlGatewayOptions {
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
  eventSourceFactory?: (url: string) => WorkspaceEventSourceLike;
}

export class BrowserWorkspaceControlGateway implements WorkspaceControlGateway {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly eventSourceFactory: (url: string) => WorkspaceEventSourceLike;
  private source: WorkspaceEventSourceLike | null = null;
  private generation = 0;

  constructor(options: BrowserWorkspaceControlGatewayOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "/api/workspace-control").replace(/\/$/, "");
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.eventSourceFactory = options.eventSourceFactory
      ?? ((url) => new EventSource(url) as unknown as WorkspaceEventSourceLike);
  }

  async connect(
    initialWorkspace: WorkspaceState,
    onEvent: (event: DurableWorkspaceEvent) => void,
  ): Promise<WorkspaceControlSnapshot> {
    const generation = ++this.generation;
    this.closeSource();
    const workspaceId = encodeURIComponent(initialWorkspace.id);
    const snapshot = await this.readJson<WorkspaceControlSnapshot>(
      `${this.baseUrl}/workspaces/${workspaceId}/initialize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: initialWorkspace }),
      },
    );
    if (generation !== this.generation) return snapshot;
    const query = new URLSearchParams();
    if (snapshot.latestCursor) query.set("after", snapshot.latestCursor);
    const suffix = query.size ? `?${query}` : "";
    const source = this.eventSourceFactory(
      `${this.baseUrl}/workspaces/${workspaceId}/stream${suffix}`,
    );
    source.addEventListener("workspace-event", (message) => {
      if (generation !== this.generation) return;
      onEvent(JSON.parse(message.data) as DurableWorkspaceEvent);
    });
    this.source = source;
    return snapshot;
  }

  read(workspaceId: string) {
    return this.readJson<WorkspaceControlSnapshot>(
      `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}`,
    );
  }

  execute(workspaceId: string, command: WorkspaceCommand) {
    return this.readJson<WorkspaceControlCommandResult>(
      `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/commands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      },
    );
  }

  close() {
    this.generation += 1;
    this.closeSource();
  }

  private closeSource() {
    this.source?.close();
    this.source = null;
  }

  private async readJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImplementation(url, init);
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body?.error || `workspace-control.http.${response.status}`);
    return body;
  }
}
