import type { BoxNode, WorkspaceState, WorkspaceView } from "@synaius/domain";

export const WORKSPACE_STORAGE_KEY = "synaius.workspace.v1";

export function loadWorkspace(fallback: WorkspaceState): WorkspaceState {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw === null) return fallback;
    const candidate: unknown = JSON.parse(raw);
    return isWorkspaceState(candidate) ? candidate : fallback;
  } catch {
    return fallback;
  }
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
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (typeof value.id !== "string" || typeof value.revision !== "number") return false;
  if (typeof value.activeViewId !== "string" || !isRecord(value.views) || !isRecord(value.boxes)) return false;
  if (!isRecord(value.deviceDefaults) || !isBoxStyle(value.globalStyle)) return false;

  const views = Object.values(value.views);
  const boxes = Object.values(value.boxes);
  if (!views.every(isWorkspaceView) || !boxes.every(isBoxNode)) return false;
  if (!Object.prototype.hasOwnProperty.call(value.views, value.activeViewId)) return false;

  return boxes.every((box) =>
    Object.prototype.hasOwnProperty.call(value.views, box.viewId)
      && (box.parentId === null || Object.prototype.hasOwnProperty.call(value.boxes, box.parentId)),
  );
}

function isWorkspaceView(value: unknown): value is WorkspaceView {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isGridDefinition(value.grid);
}

function isBoxNode(value: unknown): value is BoxNode {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.viewId === "string"
    && (value.parentId === null || typeof value.parentId === "string")
    && typeof value.name === "string"
    && isGridRect(value.rect)
    && isGridDefinition(value.childGrid)
    && isBoxStyle(value.style)
    && typeof value.archived === "boolean";
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
