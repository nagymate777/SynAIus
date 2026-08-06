import {
  migrateWorkspaceV1,
  migrateWorkspaceV2,
  migrateWorkspaceV3,
  type BoxNode,
  type DeviceKind,
  type DeviceNames,
  type LegacyBoxNodeV1,
  type LegacyBoxNodeV2,
  type LegacyBoxNodeV3,
  type LegacyWorkspaceStateV1,
  type LegacyWorkspaceStateV2,
  type LegacyWorkspaceStateV3,
  type WorkspaceState,
  type WorkspaceView,
} from "@synaius/domain";

export const WORKSPACE_STORAGE_KEY = "synaius.workspace.v4";
const V3_WORKSPACE_STORAGE_KEY = "synaius.workspace.v3";
const V2_WORKSPACE_STORAGE_KEY = "synaius.workspace.v2";
const V1_WORKSPACE_STORAGE_KEY = "synaius.workspace.v1";
const DEVICE_KINDS: DeviceKind[] = ["desktop", "tablet", "mobile"];

export function loadWorkspace(
  fallback: WorkspaceState,
  deviceNames: DeviceNames,
  activeLayout: DeviceKind,
): WorkspaceState {
  try {
    const current: unknown = parseStoredValue(WORKSPACE_STORAGE_KEY);
    if (isWorkspaceState(current)) return current;

    const versionThree: unknown = parseStoredValue(V3_WORKSPACE_STORAGE_KEY);
    if (isLegacyWorkspaceStateV3(versionThree)) return migrateWorkspaceV3(versionThree);

    const versionTwo: unknown = parseStoredValue(V2_WORKSPACE_STORAGE_KEY);
    if (isLegacyWorkspaceStateV2(versionTwo)) return migrateWorkspaceV2(versionTwo, activeLayout);

    const versionOne: unknown = parseStoredValue(V1_WORKSPACE_STORAGE_KEY);
    if (isLegacyWorkspaceState(versionOne)) return migrateWorkspaceV1(versionOne, deviceNames, activeLayout);
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
  if (!isWorkspaceBase(value) || value.schemaVersion !== 4 || !isDeviceKind(value.activeLayout)) return false;
  if (!DEVICE_KINDS.every((device) => typeof value.deviceDefaults[device] === "string"
      && Object.prototype.hasOwnProperty.call(value.views, value.deviceDefaults[device] as string))) return false;
  if (!isRecord(value.preferences)
    || typeof value.preferences.handlesVisible !== "boolean"
    || typeof value.preferences.namesVisible !== "boolean") return false;
  const localeMessages = value.localeMessages;
  if (!isStringRecord(localeMessages)) return false;

  const boxes = Object.values(value.boxes);
  if (!boxes.every(isBoxNode)) return false;
  return boxes.every((box) => referencesAreValid(value, box)
    && (box.role.type === "content"
      ? box.labelKey === null
      : typeof box.labelKey === "string" && typeof localeMessages[box.labelKey] === "string"));
}

export function isLegacyWorkspaceStateV3(value: unknown): value is LegacyWorkspaceStateV3 {
  if (!isWorkspaceBase(value) || value.schemaVersion !== 3 || !isDeviceKind(value.activeLayout)) return false;
  if (!DEVICE_KINDS.every((device) => typeof value.deviceDefaults[device] === "string"
    && Object.prototype.hasOwnProperty.call(value.views, value.deviceDefaults[device] as string))) return false;
  if (!isRecord(value.preferences)
    || typeof value.preferences.handlesVisible !== "boolean"
    || typeof value.preferences.namesVisible !== "boolean") return false;
  const boxes = Object.values(value.boxes);
  if (!boxes.every(isLegacyBoxNodeV3)) return false;
  return boxes.every((box) => referencesAreValid(value, box));
}

export function isLegacyWorkspaceStateV2(value: unknown): value is LegacyWorkspaceStateV2 {
  if (!isWorkspaceBase(value) || value.schemaVersion !== 2) return false;
  if (!isRecord(value.preferences)
    || typeof value.preferences.handlesVisible !== "boolean"
    || typeof value.preferences.namesVisible !== "boolean") return false;
  const boxes = Object.values(value.boxes);
  if (!boxes.every(isLegacyBoxNodeV2)) return false;
  return boxes.every((box) => referencesAreValid(value, box));
}

export function isLegacyWorkspaceState(value: unknown): value is LegacyWorkspaceStateV1 {
  if (!isWorkspaceBase(value) || value.schemaVersion !== 1) return false;
  return Object.values(value.boxes).every(isLegacyBoxNodeV1);
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
  if (!Object.entries(value.deviceDefaults).every(([device, viewId]) => isDeviceKind(device)
    && typeof viewId === "string"
    && Object.prototype.hasOwnProperty.call(value.views, viewId))) return false;
  return Object.prototype.hasOwnProperty.call(value.views, value.activeViewId);
}

function referencesAreValid(
  workspace: { views: Record<string, WorkspaceView>; boxes: Record<string, unknown> },
  box: BoxNode | LegacyBoxNodeV2 | LegacyBoxNodeV3,
) {
  if (box.viewId !== null && !Object.prototype.hasOwnProperty.call(workspace.views, box.viewId)) return false;
  if (box.parentId !== null && !Object.prototype.hasOwnProperty.call(workspace.boxes, box.parentId)) return false;
  if (box.role.type === "view" && !Object.prototype.hasOwnProperty.call(workspace.views, box.role.viewId)) return false;
  return true;
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
    && isBoxRole(value.role)
    && (value.labelKey === null || typeof value.labelKey === "string")
    && isLayoutRects(value.layoutRects);
}

function isLegacyBoxNodeV3(value: unknown): value is LegacyBoxNodeV3 {
  return isBoxNodeBase(value)
    && (value.viewId === null || typeof value.viewId === "string")
    && isBoxRole(value.role)
    && isLayoutRects(value.layoutRects)
    && !("labelKey" in value);
}

function isLegacyBoxNodeV2(value: unknown): value is LegacyBoxNodeV2 {
  return isBoxNodeBase(value)
    && (value.viewId === null || typeof value.viewId === "string")
    && isBoxRole(value.role)
    && isGridRect(value.rect)
    && !("layoutRects" in value)
    && !("labelKey" in value);
}

function isLegacyBoxNodeV1(value: unknown): value is LegacyBoxNodeV1 {
  return isBoxNodeBase(value)
    && typeof value.viewId === "string"
    && isGridRect(value.rect)
    && !("role" in value)
    && !("layoutRects" in value)
    && !("labelKey" in value);
}

function isBoxNodeBase(value: unknown): value is Record<string, unknown> & Omit<BoxNode, "viewId" | "role" | "layoutRects" | "labelKey"> {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.parentId === null || typeof value.parentId === "string")
    && typeof value.name === "string"
    && isGridDefinition(value.childGrid)
    && isBoxStyle(value.style)
    && typeof value.archived === "boolean";
}

function isBoxRole(value: unknown): value is BoxNode["role"] {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "content") return true;
  if (value.type === "view") return typeof value.viewId === "string";
  return value.type === "device" && isDeviceKind(value.device);
}

function isLayoutRects(value: unknown): value is BoxNode["layoutRects"] {
  return isRecord(value) && DEVICE_KINDS.every((device) => isGridRect(value[device]));
}

function isDeviceKind(value: unknown): value is DeviceKind {
  return value === "desktop" || value === "tablet" || value === "mobile";
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
