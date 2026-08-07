import {
  migrateWorkspaceV1,
  migrateWorkspaceV2,
  migrateWorkspaceV3,
  migrateWorkspaceV4,
  migrateWorkspaceV5,
  type BuiltInDeviceKind,
  type BoxNode,
  type CloneNameTemplates,
  type DeviceNames,
  type LayoutId,
  type LegacyBoxNodeV1,
  type LegacyBoxNodeV2,
  type LegacyBoxNodeV3,
  type LegacyBoxNodeV4,
  type LegacyBoxNodeV5,
  type LegacyWorkspaceStateV1,
  type LegacyWorkspaceStateV2,
  type LegacyWorkspaceStateV3,
  type LegacyWorkspaceStateV4,
  type LegacyWorkspaceStateV5,
  type WorkspaceState,
  type WorkspaceView,
} from "@synaius/domain";

export const WORKSPACE_STORAGE_KEY = "synaius.workspace.v6";
const V5_WORKSPACE_STORAGE_KEY = "synaius.workspace.v5";
const V4_WORKSPACE_STORAGE_KEY = "synaius.workspace.v4";
const V3_WORKSPACE_STORAGE_KEY = "synaius.workspace.v3";
const V2_WORKSPACE_STORAGE_KEY = "synaius.workspace.v2";
const V1_WORKSPACE_STORAGE_KEY = "synaius.workspace.v1";
const BUILT_IN_DEVICE_KINDS: BuiltInDeviceKind[] = ["desktop", "tablet", "mobile"];

export function loadWorkspace(
  fallback: WorkspaceState,
  deviceNames: DeviceNames,
  activeLayout: LayoutId,
  cloneNameTemplates: CloneNameTemplates,
): WorkspaceState {
  try {
    const current: unknown = parseStoredValue(WORKSPACE_STORAGE_KEY);
    if (isWorkspaceState(current)) return current;

    const versionFive: unknown = parseStoredValue(V5_WORKSPACE_STORAGE_KEY);
    if (isLegacyWorkspaceStateV5(versionFive)) return migrateWorkspaceV5(versionFive);

    const versionFour: unknown = parseStoredValue(V4_WORKSPACE_STORAGE_KEY);
    if (isLegacyWorkspaceStateV4(versionFour)) return migrateWorkspaceV4(versionFour, cloneNameTemplates);

    const versionThree: unknown = parseStoredValue(V3_WORKSPACE_STORAGE_KEY);
    if (isLegacyWorkspaceStateV3(versionThree)) return migrateWorkspaceV3(versionThree, cloneNameTemplates);

    const versionTwo: unknown = parseStoredValue(V2_WORKSPACE_STORAGE_KEY);
    if (isLegacyWorkspaceStateV2(versionTwo)) {
      return migrateWorkspaceV2(versionTwo, legacyLayoutOrDesktop(activeLayout), cloneNameTemplates);
    }

    const versionOne: unknown = parseStoredValue(V1_WORKSPACE_STORAGE_KEY);
    if (isLegacyWorkspaceState(versionOne)) {
      return migrateWorkspaceV1(versionOne, deviceNames, legacyLayoutOrDesktop(activeLayout), cloneNameTemplates);
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function upgradeWorkspaceState(
  value: unknown,
  deviceNames: DeviceNames,
  activeLayout: LayoutId,
  cloneNameTemplates: CloneNameTemplates,
): WorkspaceState | null {
  if (isWorkspaceState(value)) return value;
  if (isLegacyWorkspaceStateV5(value)) return migrateWorkspaceV5(value);
  if (isLegacyWorkspaceStateV4(value)) return migrateWorkspaceV4(value, cloneNameTemplates);
  if (isLegacyWorkspaceStateV3(value)) return migrateWorkspaceV3(value, cloneNameTemplates);
  if (isLegacyWorkspaceStateV2(value)) {
    return migrateWorkspaceV2(value, legacyLayoutOrDesktop(activeLayout), cloneNameTemplates);
  }
  if (isLegacyWorkspaceState(value)) {
    return migrateWorkspaceV1(value, deviceNames, legacyLayoutOrDesktop(activeLayout), cloneNameTemplates);
  }
  return null;
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
  if (!isWorkspaceBase(value) || value.schemaVersion !== 6 || typeof value.activeLayout !== "string") return false;
  if (!isDeviceLayouts(value.layouts) || !isLayoutOrder(value.layoutOrder, value.layouts)) return false;
  const layouts = value.layouts;
  if (!BUILT_IN_DEVICE_KINDS.every((layoutId) => layouts[layoutId]?.builtIn)
    || Object.values(layouts).some((layout) =>
      layout.builtIn && !BUILT_IN_DEVICE_KINDS.includes(layout.id as BuiltInDeviceKind))) return false;
  if (!Object.prototype.hasOwnProperty.call(layouts, value.activeLayout)) return false;
  if (!hasCompleteLayoutDefaults(value, layouts) || !isWorkspacePreferences(value.preferences)) return false;
  const localeMessages = value.localeMessages;
  if (!isStringRecord(localeMessages)
    || typeof localeMessages["box.cloneName"] !== "string"
    || typeof localeMessages["box.cloneNameNumbered"] !== "string") return false;

  const layoutIds = Object.keys(layouts);
  const boxes = Object.values(value.boxes);
  if (!boxes.every((box) => isBoxNode(box, layoutIds))) return false;
  const typedBoxes = boxes as BoxNode[];
  const candidate = value as unknown as WorkspaceState;
  return typedBoxes.every((box) => referencesAreValid(candidate, box)
    && boxRoleReferenceIsValid(candidate, box)
    && cloneReferenceIsValid(candidate, box)
    && (box.role.type === "content"
      ? box.labelKey === null
      : typeof box.labelKey === "string" && typeof localeMessages[box.labelKey] === "string"))
    && layoutsHaveValidControls(candidate);
}

export function isLegacyWorkspaceStateV5(value: unknown): value is LegacyWorkspaceStateV5 {
  if (!isWorkspaceBase(value) || value.schemaVersion !== 5 || !isLegacyDeviceKind(value.activeLayout)) return false;
  if (!hasCompleteLegacyDeviceDefaults(value) || !isWorkspacePreferences(value.preferences)) return false;
  const localeMessages = value.localeMessages;
  if (!isStringRecord(localeMessages)
    || typeof localeMessages["box.cloneName"] !== "string"
    || typeof localeMessages["box.cloneNameNumbered"] !== "string") return false;
  const boxes = Object.values(value.boxes);
  if (!boxes.every(isLegacyBoxNodeV5)) return false;
  return boxes.every((box) => referencesAreValid(value, box)
    && legacyBoxRoleReferenceIsValid(value, box)
    && legacyCloneReferenceIsValid(value, box)
    && (box.role.type === "content"
      ? box.labelKey === null
      : typeof box.labelKey === "string" && typeof localeMessages[box.labelKey] === "string"));
}

export function isLegacyWorkspaceStateV4(value: unknown): value is LegacyWorkspaceStateV4 {
  if (!isWorkspaceBase(value) || value.schemaVersion !== 4 || !isLegacyDeviceKind(value.activeLayout)) return false;
  if (!hasCompleteLegacyDeviceDefaults(value) || !isWorkspacePreferences(value.preferences)) return false;
  if (!isStringRecord(value.localeMessages)) return false;
  const boxes = Object.values(value.boxes);
  if (!boxes.every(isLegacyBoxNodeV4)) return false;
  return boxes.every((box) => referencesAreValid(value, box));
}

export function isLegacyWorkspaceStateV3(value: unknown): value is LegacyWorkspaceStateV3 {
  if (!isWorkspaceBase(value) || value.schemaVersion !== 3 || !isLegacyDeviceKind(value.activeLayout)) return false;
  if (!hasCompleteLegacyDeviceDefaults(value) || !isWorkspacePreferences(value.preferences)) return false;
  const boxes = Object.values(value.boxes);
  if (!boxes.every(isLegacyBoxNodeV3)) return false;
  return boxes.every((box) => referencesAreValid(value, box));
}

export function isLegacyWorkspaceStateV2(value: unknown): value is LegacyWorkspaceStateV2 {
  if (!isWorkspaceBase(value) || value.schemaVersion !== 2) return false;
  if (!isWorkspacePreferences(value.preferences)) return false;
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
  deviceDefaults: Record<string, string>;
  views: Record<string, WorkspaceView>;
  boxes: Record<string, unknown>;
  globalStyle: WorkspaceState["globalStyle"];
} {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.revision !== "number") return false;
  if (typeof value.activeViewId !== "string" || !isRecord(value.views) || !isRecord(value.boxes)) return false;
  if (!isRecord(value.deviceDefaults) || !isBoxStyle(value.globalStyle)) return false;
  if (!Object.values(value.views).every(isWorkspaceView)) return false;
  if (!Object.entries(value.deviceDefaults).every(([layoutId, viewId]) => layoutId.length > 0
    && typeof viewId === "string"
    && Object.prototype.hasOwnProperty.call(value.views, viewId))) return false;
  return Object.prototype.hasOwnProperty.call(value.views, value.activeViewId);
}

function referencesAreValid(
  workspace: { views: Record<string, WorkspaceView>; boxes: Record<string, unknown> },
  box: BoxNode | LegacyBoxNodeV2 | LegacyBoxNodeV3 | LegacyBoxNodeV4 | LegacyBoxNodeV5,
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

function isBoxNode(value: unknown, layoutIds: string[]): value is BoxNode {
  return isCommonBoxNodeBase(value)
    && (value.viewId === null || typeof value.viewId === "string")
    && isBoxRole(value.role)
    && (value.labelKey === null || typeof value.labelKey === "string")
    && isLayoutRects(value.layoutRects, layoutIds)
    && typeof value.hiddenWhenLocked === "boolean"
    && ((value.cloneSourceId === null && value.cloneOrdinal === null)
      || (typeof value.cloneSourceId === "string"
        && Number.isInteger(value.cloneOrdinal)
        && (value.cloneOrdinal as number) > 0));
}

function isLegacyBoxNodeV5(value: unknown): value is LegacyBoxNodeV5 {
  return isCommonBoxNodeBase(value)
    && (value.viewId === null || typeof value.viewId === "string")
    && isLegacyBoxRole(value.role)
    && (value.labelKey === null || typeof value.labelKey === "string")
    && isLegacyLayoutRects(value.layoutRects)
    && ((value.cloneSourceId === null && value.cloneOrdinal === null)
      || (typeof value.cloneSourceId === "string"
        && Number.isInteger(value.cloneOrdinal)
        && (value.cloneOrdinal as number) > 0))
    && !("hiddenWhenLocked" in value);
}

function isLegacyBoxNodeV4(value: unknown): value is LegacyBoxNodeV4 {
  return isLegacyBoxNodeBase(value)
    && (value.viewId === null || typeof value.viewId === "string")
    && isLegacyBoxRole(value.role)
    && (value.labelKey === null || typeof value.labelKey === "string")
    && isLegacyLayoutRects(value.layoutRects);
}

function isLegacyBoxNodeV3(value: unknown): value is LegacyBoxNodeV3 {
  return isLegacyBoxNodeBase(value)
    && (value.viewId === null || typeof value.viewId === "string")
    && isLegacyBoxRole(value.role)
    && isLegacyLayoutRects(value.layoutRects)
    && !("labelKey" in value);
}

function isLegacyBoxNodeV2(value: unknown): value is LegacyBoxNodeV2 {
  return isLegacyBoxNodeBase(value)
    && (value.viewId === null || typeof value.viewId === "string")
    && isLegacyBoxRole(value.role)
    && isLegacyGridRect(value.rect)
    && !("layoutRects" in value)
    && !("labelKey" in value);
}

function isLegacyBoxNodeV1(value: unknown): value is LegacyBoxNodeV1 {
  return isLegacyBoxNodeBase(value)
    && typeof value.viewId === "string"
    && isLegacyGridRect(value.rect)
    && !("role" in value)
    && !("layoutRects" in value)
    && !("labelKey" in value);
}

function isCommonBoxNodeBase(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.parentId === null || typeof value.parentId === "string")
    && typeof value.name === "string"
    && isGridDefinition(value.childGrid)
    && isBoxStyle(value.style);
}

function isLegacyBoxNodeBase(value: unknown): value is Record<string, unknown> {
  return isCommonBoxNodeBase(value) && typeof value.archived === "boolean";
}

function isBoxRole(value: unknown): value is BoxNode["role"] {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "content") return true;
  if (value.type === "view") return typeof value.viewId === "string";
  return value.type === "device" && typeof value.device === "string" && value.device.length > 0;
}

function isLegacyBoxRole(value: unknown): value is BoxNode["role"] {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "content") return true;
  if (value.type === "view") return typeof value.viewId === "string";
  return value.type === "device" && isLegacyDeviceKind(value.device);
}

function isLayoutRects(value: unknown, layoutIds: string[]): value is BoxNode["layoutRects"] {
  return isRecord(value)
    && Object.keys(value).length === layoutIds.length
    && layoutIds.every((layoutId) => isGridRect(value[layoutId]));
}

function isLegacyLayoutRects(value: unknown) {
  return isRecord(value) && BUILT_IN_DEVICE_KINDS.every((device) => isLegacyGridRect(value[device]));
}

function isLegacyDeviceKind(value: unknown): value is BuiltInDeviceKind {
  return value === "desktop" || value === "tablet" || value === "mobile";
}

function legacyLayoutOrDesktop(value: LayoutId): BuiltInDeviceKind {
  return isLegacyDeviceKind(value) ? value : "desktop";
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
    && (value.width as number) > 0
    && (value.height as number) > 0;
}

function isLegacyGridRect(value: unknown) {
  return isGridRect(value)
    && (value as { column: number }).column >= 0
    && (value as { row: number }).row >= 0;
}

function isDeviceLayouts(value: unknown): value is WorkspaceState["layouts"] {
  return isRecord(value) && Object.entries(value).every(([layoutId, layout]) =>
    isRecord(layout)
    && layout.id === layoutId
    && typeof layout.name === "string"
    && typeof layout.labelKey === "string"
    && typeof layout.builtIn === "boolean");
}

function isLayoutOrder(value: unknown, layouts: WorkspaceState["layouts"]): value is string[] {
  return Array.isArray(value)
    && value.every((layoutId) => typeof layoutId === "string")
    && value.length === Object.keys(layouts).length
    && new Set(value).size === value.length
    && value.every((layoutId) => Object.prototype.hasOwnProperty.call(layouts, layoutId));
}

function hasCompleteLayoutDefaults(value: {
  deviceDefaults: Record<string, string>;
  views: Record<string, WorkspaceView>;
}, layouts: WorkspaceState["layouts"]) {
  const layoutIds = Object.keys(layouts);
  return Object.keys(value.deviceDefaults).length === layoutIds.length
    && layoutIds.every((layoutId) => typeof value.deviceDefaults[layoutId] === "string"
      && Object.prototype.hasOwnProperty.call(value.views, value.deviceDefaults[layoutId]));
}

function hasCompleteLegacyDeviceDefaults(value: {
  deviceDefaults: Record<string, string>;
  views: Record<string, WorkspaceView>;
}) {
  return BUILT_IN_DEVICE_KINDS.every((device) => typeof value.deviceDefaults[device] === "string"
    && Object.prototype.hasOwnProperty.call(value.views, value.deviceDefaults[device] as string));
}

function isWorkspacePreferences(value: unknown) {
  return isRecord(value)
    && typeof value.handlesVisible === "boolean"
    && typeof value.namesVisible === "boolean";
}

function cloneReferenceIsValid(
  workspace: { boxes: Record<string, unknown> },
  box: BoxNode,
) {
  if (box.cloneSourceId === null) return box.cloneOrdinal === null;
  const source = workspace.boxes[box.cloneSourceId] as BoxNode | undefined;
  return Boolean(source && source.role.type === "content" && source.cloneSourceId === null);
}

function legacyCloneReferenceIsValid(
  workspace: { boxes: Record<string, unknown> },
  box: LegacyBoxNodeV5,
) {
  if (box.cloneSourceId === null) return box.cloneOrdinal === null;
  const source = workspace.boxes[box.cloneSourceId] as LegacyBoxNodeV5 | undefined;
  return Boolean(source && source.role.type === "content" && source.cloneSourceId === null);
}

function boxRoleReferenceIsValid(workspace: WorkspaceState, box: BoxNode) {
  return box.role.type !== "device" || Object.prototype.hasOwnProperty.call(workspace.layouts, box.role.device);
}

function legacyBoxRoleReferenceIsValid(
  workspace: { views: Record<string, WorkspaceView> },
  box: LegacyBoxNodeV5,
) {
  return box.role.type !== "view" || Object.prototype.hasOwnProperty.call(workspace.views, box.role.viewId);
}

function layoutsHaveValidControls(workspace: WorkspaceState) {
  return Object.values(workspace.layouts).every((layout) => {
    if (typeof workspace.localeMessages[layout.labelKey] !== "string") return false;
    const controls = Object.values(workspace.boxes).filter((box) =>
      box.role.type === "device" && box.role.device === layout.id);
    return controls.length === 1 && controls[0].labelKey === layout.labelKey;
  });
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
