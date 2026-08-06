import type { DeviceKind, DeviceNames, WorkspaceState } from "@synaius/domain";
import { isWorkspaceState, upgradeWorkspaceState } from "./workspace-storage";

export const WORKSPACE_SNAPSHOTS_STORAGE_KEY = "synaius.workspace-snapshots.v1";

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  createdAt: string;
  workspace: WorkspaceState;
}

export function loadWorkspaceSnapshots(): WorkspaceSnapshot[] {
  try {
    const raw = localStorage.getItem(WORKSPACE_SNAPSHOTS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWorkspaceSnapshot);
  } catch {
    return [];
  }
}

export function saveWorkspaceSnapshots(snapshots: WorkspaceSnapshot[]) {
  try {
    localStorage.setItem(WORKSPACE_SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
    return true;
  } catch {
    return false;
  }
}

export function createWorkspaceSnapshot(workspace: WorkspaceState, name: string): WorkspaceSnapshot {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    createdAt: new Date().toISOString(),
    workspace: structuredClone(workspace),
  };
}

export function parseWorkspaceExport(
  text: string,
  deviceNames: DeviceNames,
  activeLayout: DeviceKind,
): WorkspaceState | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return upgradeWorkspaceState(parsed, deviceNames, activeLayout);
  } catch {
    return null;
  }
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<WorkspaceSnapshot>;
  return typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.createdAt === "string"
    && Number.isFinite(Date.parse(candidate.createdAt))
    && isWorkspaceState(candidate.workspace);
}
