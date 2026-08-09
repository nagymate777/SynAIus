import type { WorkspaceCommand, WorkspaceState } from "@synaius/domain";

export type WorkspaceControlCursor = string;

export interface DurableWorkspaceEvent {
  cursor: WorkspaceControlCursor;
  workspaceId: string;
  revision: number;
  command: WorkspaceCommand;
  occurredAt: string;
}

export interface WorkspaceControlSnapshot {
  workspace: WorkspaceState;
  latestCursor: WorkspaceControlCursor | null;
}

export interface WorkspaceControlCommandResult extends WorkspaceControlSnapshot {
  event: DurableWorkspaceEvent;
}

export interface WorkspaceControlGateway {
  connect(
    initialWorkspace: WorkspaceState,
    onEvent: (event: DurableWorkspaceEvent) => void,
  ): Promise<WorkspaceControlSnapshot>;
  read(workspaceId: string): Promise<WorkspaceControlSnapshot>;
  execute(workspaceId: string, command: WorkspaceCommand): Promise<WorkspaceControlCommandResult>;
  close(): void;
}
