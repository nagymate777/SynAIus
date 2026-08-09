import type { WorkspaceCommand, WorkspaceState } from "@synaius/domain";
import type { DurableWorkspaceEvent, WorkspaceControlCursor } from "../index.ts";
import type { WorkspaceControlStore } from "./store.ts";

export class WorkspaceControlService {
  private readonly listeners = new Map<string, Set<(event: DurableWorkspaceEvent) => void>>();
  private readonly store: WorkspaceControlStore;

  constructor(store: WorkspaceControlStore) {
    this.store = store;
  }

  status() {
    return { status: "ready" as const };
  }

  initialize(workspace: WorkspaceState) {
    return this.store.initialize(workspace);
  }

  read(workspaceId: string) {
    return this.store.read(workspaceId);
  }

  execute(workspaceId: string, command: WorkspaceCommand) {
    const result = this.store.execute(workspaceId, command);
    if (!result.duplicate) this.publish(result.event);
    const { duplicate: _duplicate, ...response } = result;
    return response;
  }

  eventsAfter(
    workspaceId: string,
    after: WorkspaceControlCursor | null = null,
    limit = 500,
    through: WorkspaceControlCursor | null = null,
  ) {
    return this.store.eventsAfter(workspaceId, after, limit, through);
  }

  latestCursor(workspaceId: string) {
    return this.store.latestCursor(workspaceId);
  }

  subscribe(workspaceId: string, listener: (event: DurableWorkspaceEvent) => void) {
    const listeners = this.listeners.get(workspaceId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(workspaceId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(workspaceId);
    };
  }

  close() {
    this.listeners.clear();
    this.store.close();
  }

  private publish(event: DurableWorkspaceEvent) {
    this.listeners.get(event.workspaceId)?.forEach((listener) => listener(event));
  }
}
