import {
  migrateWorkspaceV1,
  type BoxNode,
  type DeviceKind,
  type DeviceNames,
  type LegacyBoxNodeV1,
  type LegacyWorkspaceStateV1,
  type WorkspaceState,
  type WorkspaceView,
} from "@synaius/domain";

export const WORKSPACE_STORAGE_KEY = "synaius.workspace.v2";
const LEGACY_WORKSPACE_STORAGE_KEY = "synaius.workspace.v1";

export function loadWorkspace(fallback: WorkspaceState, deviceNames: DeviceNames): WorkspaceState {
  try {
    const current: unknown = parseStoredValue(WORKSPACE_STORAGE_KEY);
    if (isWorkspaceState(current)) return current;

    const legacy: unknown = parseStoredValue(LEGACY_WORKSPACE_STORAGE_KEY);
    if (isLegacyWorkspaceState(legacy)) return migrateWorkspaceV1(legacy, deviceNames);
  } catch {
    return fallback;
  }
  return fallback;
}

export function saveWorkspace(workspace: WorkspaceState) {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    return false;
  }
  return true;
}

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!isWorkspaceBase(value) || value.schemaVersion !== 2) return false;
  if (!isRecord(value.preferences)
    || typeof value.preferences.handlesVisible !== "boolean"
    || typeof value.preferences.namesVisible !== "boolean") return false;

  const boxes = Object.values(value.boxes);
  if (!boxes.every(isBoxNode)) return false;
  return boxes.every((box) => {
    if (box.viewId !== null && !Object.prototype.hasOwnProperty.call(value.views, box.viewId)) return false;
    if (box.parentId !== null && !Object.prototype.hasOwnProperty.call(value.boxes, box.parentId)) return false;
    if (box.role.type === "view" && !Object.prototype.hasOwnProperty.call(value.views, box.role.viewId)) return false;
    return true;
  });
}

export function isLegacyWorkspaceState(value: unknown): value is LegacyWorkspaceStateV1 {
  if (!isWorkspaceBase(value) || value.schemaVersion !== 1) return false;
  return Object.values(value.boxes).every(isLegacyBoxNode);
}

function parseStoredValue(key: string): unknown {
  const raw = localStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}

function isWorkspaceBase(value: unknown): value is Record<string, unknown> & {
  id: string;
  revision: number;
  activeViewId: string;
  deviceDefaults: Partial<Record<DeviceKind, string>>;
  views: Record<string, WorkspaceView>;
  boxes: Record<string, unknown>;
  globalStyle: WorkspaceState["globalStyle"];
} {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.revision !== "number") return false;
  if (typeof value.activeViewId !== "string" || !isRecord(value.views) || !isRecord(value.boxes)) return false;
  if (!isRecord(value.deviceDefaults) || !isBoxStyle(value.globalStyle)) return false;
  if (!Object.values(value.views).every(isWorkspaceView)) return false;
  return Object.prototype.hasOwnProperty.call(value.views, value.activeViewId);
}

function isWorkspaceView(value: unknown): value is WorkspaceView {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isGridDefinition(value.grid);
}

function isBoxNode(value: unknown): value is BoxNode {
  return isBoxNodeBase(value)
    && (value.viewId === null || typeof value.viewId === "string")
    && isBoxRole(value.role);
}

function isLegacyBoxNode(value: unknown): value is LegacyBoxNodeV1 {
  return isBoxNodeBase(value) && typeof value.viewId === "string" && !("role" in value);
}

function isBoxNodeBase(value: unknown): value is Record<string, unknown> & Omit<BoxNode, "viewId" | "role"> {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.parentId === null || typeof value.parentId === "string")
    && typeof value.name === "string"
    && isGridRect(value.rect)
    && isGridDefinition(value.childGrid)
    && isBoxStyle(value.style)
    && typeof value.archived === "boolean";
}

function isBoxRole(value: unknown): value is BoxNode["role"] {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "content") return true;
  if (value.type === "view") return typeof value.viewId === "string";
  return value.type === "device" && ["desktop", "tablet", "mobile"].includes(String(value.device));
}

function isGridDefinition(value: unknown) {
  return isRecord(value)
    && Number.isInteger(value.columns)
    && (value.columns as number) > 0
    && typeof value.visible === "boolean";
}

function isGridRect(value: unknown) {
  return isRecord(value)
    && Number.isInteger(value.column)
    && Number.isInteger(value.row)
    && Number.isInteger(value.width)
    && Number.isInteger(value.height)
    && (value.column as number) >= 0
    && (value.row as number) >= 0
    && (value.width as number) > 0
    && (value.height as number) > 0;
}

function isBoxStyle(value: unknown) {
  return isRecord(value)
    && isRecord(value.declarations)
    && Object.values(value.declarations).every((entry) => typeof entry === "string")
    && typeof value.scopedCss === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
