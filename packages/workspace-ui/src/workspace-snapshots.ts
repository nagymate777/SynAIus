import type { CloneNameTemplates, DeviceNames, LayoutId, WorkspaceState } from "@synaius/domain";
import { upgradeWorkspaceState } from "./workspace-storage";

export const WORKSPACE_SNAPSHOTS_STORAGE_KEY = "synaius.workspace-snapshots.v1";

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  createdAt: string;
  workspace: WorkspaceState;
}

export function loadWorkspaceSnapshots(
  deviceNames: DeviceNames,
  activeLayout: LayoutId,
  cloneNameTemplates: CloneNameTemplates,
  storageNamespace = "synaius",
): WorkspaceSnapshot[] {
  try {
    const raw = localStorage.getItem(snapshotStorageKey(storageNamespace));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!isSnapshotMetadata(value)) return [];
      const workspace = upgradeWorkspaceState(value.workspace, deviceNames, activeLayout, cloneNameTemplates);
      return workspace ? [{ ...value, workspace }] : [];
    });
  } catch {
    return [];
  }
}

export function saveWorkspaceSnapshots(snapshots: WorkspaceSnapshot[], storageNamespace = "synaius") {
  try {
    localStorage.setItem(snapshotStorageKey(storageNamespace), JSON.stringify(snapshots));
    return true;
  } catch {
    return false;
  }
}

function snapshotStorageKey(storageNamespace: string) {
  return `${storageNamespace}.workspace-snapshots.v1`;
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
  activeLayout: LayoutId,
  cloneNameTemplates: CloneNameTemplates,
): WorkspaceState | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return upgradeWorkspaceState(parsed, deviceNames, activeLayout, cloneNameTemplates);
  } catch {
    return null;
  }
}

function isSnapshotMetadata(value: unknown): value is Omit<WorkspaceSnapshot, "workspace"> & { workspace: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<WorkspaceSnapshot>;
  return typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.createdAt === "string"
    && Number.isFinite(Date.parse(candidate.createdAt))
    && typeof candidate.workspace === "object"
    && candidate.workspace !== null;
}
