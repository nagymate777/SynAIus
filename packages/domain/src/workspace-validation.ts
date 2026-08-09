import { isJsonObject, type ContentInstance } from "@synaius/content";
import type { BoxNode, BuiltInDeviceKind, WorkspaceState, WorkspaceView } from "./workspace.ts";

const BUILT_IN_DEVICE_KINDS: BuiltInDeviceKind[] = ["desktop", "tablet", "mobile"];

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!isWorkspaceBase(value) || value.schemaVersion !== 8 || typeof value.activeLayout !== "string") return false;
  if (!isDeviceLayouts(value.layouts) || !isLayoutOrder(value.layoutOrder, value.layouts)) return false;
  const layouts = value.layouts;
  if (!BUILT_IN_DEVICE_KINDS.every((layoutId) => layouts[layoutId]?.builtIn)
    || Object.values(layouts).some((layout) =>
      layout.builtIn && !BUILT_IN_DEVICE_KINDS.includes(layout.id as BuiltInDeviceKind))) return false;
  if (!Object.prototype.hasOwnProperty.call(layouts, value.activeLayout)) return false;
  if (!hasCompleteLayoutDefaults(value, layouts) || !isWorkspacePreferences(value.preferences)) return false;
  const localeMessages = value.localeMessages;
  if (!isStringRecord(localeMessages)
    || typeof localeMessages["workspace.box.cloneName"] !== "string"
    || typeof localeMessages["workspace.box.cloneNameNumbered"] !== "string") return false;
  if (!isRecord(value.contents)
    || !Object.entries(value.contents).every(([contentId, content]) =>
      isContentInstance(content) && content.id === contentId)) return false;

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
      : box.contentId === null
        && typeof box.labelKey === "string"
        && typeof localeMessages[box.labelKey] === "string")
    && (box.contentId === null || Object.prototype.hasOwnProperty.call(candidate.contents, box.contentId)))
    && layoutsHaveValidControls(candidate)
    && permissionGrantsAreValid(candidate);
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
  if (typeof value.id !== "string" || !value.id.trim()
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  if (typeof value.activeViewId !== "string" || !isRecord(value.views) || !isRecord(value.boxes)) return false;
  if (!isRecord(value.deviceDefaults) || !isBoxStyle(value.globalStyle)) return false;
  if (!Object.values(value.views).every(isWorkspaceView)) return false;
  if (!Object.entries(value.deviceDefaults).every(([layoutId, viewId]) => layoutId.length > 0
    && typeof viewId === "string"
    && Object.prototype.hasOwnProperty.call(value.views, viewId))) return false;
  return Object.prototype.hasOwnProperty.call(value.views, value.activeViewId);
}

function isWorkspaceView(value: unknown): value is WorkspaceView {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isGridDefinition(value.grid);
}

function isBoxNode(value: unknown, layoutIds: string[]): value is BoxNode {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.parentId === null || typeof value.parentId === "string")
    && typeof value.name === "string"
    && isGridDefinition(value.childGrid)
    && isBoxStyle(value.style)
    && (value.viewId === null || typeof value.viewId === "string")
    && isBoxRole(value.role)
    && (value.labelKey === null || typeof value.labelKey === "string")
    && isLayoutRects(value.layoutRects, layoutIds)
    && (value.contentId === null || (typeof value.contentId === "string" && value.contentId.length > 0))
    && typeof value.hiddenWhenLocked === "boolean"
    && ((value.cloneSourceId === null && value.cloneOrdinal === null)
      || (typeof value.cloneSourceId === "string"
        && Number.isInteger(value.cloneOrdinal)
        && (value.cloneOrdinal as number) > 0));
}

function referencesAreValid(workspace: WorkspaceState, box: BoxNode) {
  if (box.viewId !== null && !Object.prototype.hasOwnProperty.call(workspace.views, box.viewId)) return false;
  if (box.parentId !== null && !Object.prototype.hasOwnProperty.call(workspace.boxes, box.parentId)) return false;
  if (box.role.type === "view" && !Object.prototype.hasOwnProperty.call(workspace.views, box.role.viewId)) return false;
  return true;
}

function isBoxRole(value: unknown): value is BoxNode["role"] {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "content") return true;
  if (value.type === "view") return typeof value.viewId === "string";
  return value.type === "device" && typeof value.device === "string" && value.device.length > 0;
}

function isLayoutRects(value: unknown, layoutIds: string[]): value is BoxNode["layoutRects"] {
  return isRecord(value)
    && Object.keys(value).length === layoutIds.length
    && layoutIds.every((layoutId) => isGridRect(value[layoutId]));
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

function isWorkspacePreferences(value: unknown) {
  return isRecord(value)
    && typeof value.handlesVisible === "boolean"
    && typeof value.namesVisible === "boolean";
}

function cloneReferenceIsValid(workspace: WorkspaceState, box: BoxNode) {
  if (box.cloneSourceId === null) return box.cloneOrdinal === null;
  const source = workspace.boxes[box.cloneSourceId];
  return Boolean(source && source.role.type === "content" && source.cloneSourceId === null);
}

function boxRoleReferenceIsValid(workspace: WorkspaceState, box: BoxNode) {
  return box.role.type !== "device" || Object.prototype.hasOwnProperty.call(workspace.layouts, box.role.device);
}

function layoutsHaveValidControls(workspace: WorkspaceState) {
  return Object.values(workspace.layouts).every((layout) => {
    if (typeof workspace.localeMessages[layout.labelKey] !== "string") return false;
    const controls = Object.values(workspace.boxes).filter((box) =>
      box.role.type === "device" && box.role.device === layout.id);
    return controls.length === 1 && controls[0].labelKey === layout.labelKey;
  });
}

function permissionGrantsAreValid(workspace: WorkspaceState) {
  if (!isRecord(workspace.permissionGrants)) return false;
  return Object.entries(workspace.permissionGrants).every(([boxId, value]) => {
    const box = workspace.boxes[boxId];
    const content = box?.contentId ? workspace.contents[box.contentId] : null;
    return Boolean(content)
      && Array.isArray(value)
      && value.length > 0
      && new Set(value).size === value.length
      && value.every((permission) => typeof permission === "string"
        && content!.requiredPermissions.includes(permission));
  });
}

function isBoxStyle(value: unknown) {
  return isRecord(value)
    && isRecord(value.declarations)
    && Object.values(value.declarations).every((entry) => typeof entry === "string")
    && typeof value.scopedCss === "string";
}

function isContentInstance(value: unknown): value is ContentInstance {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.type === "string"
    && Number.isInteger(value.rendererVersion)
    && (value.rendererVersion as number) > 0
    && Number.isInteger(value.revision)
    && (value.revision as number) >= 0
    && isJsonObject(value.configuration)
    && Array.isArray(value.requiredPermissions)
    && new Set(value.requiredPermissions).size === value.requiredPermissions.length
    && value.requiredPermissions.every((permission) => typeof permission === "string" && permission.trim().length > 0)
    && (value.sourceNodeId === null || (typeof value.sourceNodeId === "string" && value.sourceNodeId.length > 0));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
