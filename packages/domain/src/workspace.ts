export type DeviceKind = "desktop" | "tablet" | "mobile";

export type DeviceNames = Record<DeviceKind, string>;

export interface CloneNameTemplates {
  first: string;
  numbered: string;
}

export interface GridRect {
  column: number;
  row: number;
  width: number;
  height: number;
}

export interface GridDefinition {
  columns: number;
  visible: boolean;
}

export interface BoxStyle {
  declarations: Record<string, string>;
  scopedCss: string;
}

export type BoxRole =
  | { type: "content" }
  | { type: "view"; viewId: string }
  | { type: "device"; device: DeviceKind };

export interface BoxNode {
  id: string;
  viewId: string | null;
  parentId: string | null;
  name: string;
  labelKey: string | null;
  layoutRects: Record<DeviceKind, GridRect>;
  childGrid: GridDefinition;
  style: BoxStyle;
  role: BoxRole;
  cloneSourceId: string | null;
  cloneOrdinal: number | null;
}

export interface WorkspaceView {
  id: string;
  name: string;
  grid: GridDefinition;
}

export interface WorkspacePreferences {
  handlesVisible: boolean;
  namesVisible: boolean;
}

export interface WorkspaceState {
  schemaVersion: 5;
  id: string;
  revision: number;
  activeViewId: string;
  activeLayout: DeviceKind;
  deviceDefaults: Record<DeviceKind, string>;
  views: Record<string, WorkspaceView>;
  boxes: Record<string, BoxNode>;
  preferences: WorkspacePreferences;
  localeMessages: Record<string, string>;
  globalStyle: BoxStyle;
}

interface LegacyBoxNodeBase {
  id: string;
  parentId: string | null;
  name: string;
  childGrid: GridDefinition;
  style: BoxStyle;
  archived: boolean;
}

export interface LegacyBoxNodeV1 extends LegacyBoxNodeBase {
  viewId: string;
  rect: GridRect;
}

interface LegacyWorkspaceBase {
  id: string;
  revision: number;
  activeViewId: string;
  deviceDefaults: Partial<Record<DeviceKind, string>>;
  views: Record<string, WorkspaceView>;
  globalStyle: BoxStyle;
}

export interface LegacyWorkspaceStateV1 extends LegacyWorkspaceBase {
  schemaVersion: 1;
  boxes: Record<string, LegacyBoxNodeV1>;
}

export interface LegacyBoxNodeV2 extends LegacyBoxNodeBase {
  viewId: string | null;
  rect: GridRect;
  role: BoxRole;
}

export interface LegacyWorkspaceStateV2 extends LegacyWorkspaceBase {
  schemaVersion: 2;
  boxes: Record<string, LegacyBoxNodeV2>;
  preferences: WorkspacePreferences;
}

export interface LegacyBoxNodeV3 extends LegacyBoxNodeBase {
  viewId: string | null;
  labelKey?: never;
  layoutRects: Record<DeviceKind, GridRect>;
  role: BoxRole;
}

export interface LegacyWorkspaceStateV3 extends LegacyWorkspaceBase {
  schemaVersion: 3;
  activeLayout: DeviceKind;
  deviceDefaults: Record<DeviceKind, string>;
  boxes: Record<string, LegacyBoxNodeV3>;
  preferences: WorkspacePreferences;
}

export interface LegacyBoxNodeV4 extends LegacyBoxNodeBase {
  viewId: string | null;
  labelKey: string | null;
  layoutRects: Record<DeviceKind, GridRect>;
  role: BoxRole;
}

export interface LegacyWorkspaceStateV4 extends LegacyWorkspaceBase {
  schemaVersion: 4;
  activeLayout: DeviceKind;
  deviceDefaults: Record<DeviceKind, string>;
  boxes: Record<string, LegacyBoxNodeV4>;
  preferences: WorkspacePreferences;
  localeMessages: Record<string, string>;
}

interface CommandEnvelope<TType extends string, TPayload> {
  id: string;
  expectedRevision: number;
  type: TType;
  payload: TPayload;
}

export type WorkspaceCommand =
  | CommandEnvelope<"view.create", { viewId: string; name: string }>
  | CommandEnvelope<"view.activate", { viewId: string }>
  | CommandEnvelope<"view.setDeviceDefault", { device: DeviceKind; viewId: string }>
  | CommandEnvelope<"layout.activate", { device: DeviceKind }>
  | CommandEnvelope<"layout.copy", { source: DeviceKind; target: DeviceKind; viewId: string; boxId: string | null }>
  | CommandEnvelope<"grid.visibility.set", { viewId: string; visible: boolean }>
  | CommandEnvelope<"workspace.handles.set", { visible: boolean }>
  | CommandEnvelope<"workspace.names.set", { visible: boolean }>
  | CommandEnvelope<"localization.message.set", { key: string; value: string }>
  | CommandEnvelope<"box.create", { boxId: string; viewId: string; parentId: string | null; name: string; rect: GridRect }>
  | CommandEnvelope<"box.rename", { boxId: string; name: string }>
  | CommandEnvelope<"box.move", { boxId: string; layout: DeviceKind; column: number; row: number }>
  | CommandEnvelope<"box.resize", { boxId: string; layout: DeviceKind; rect: GridRect }>
  | CommandEnvelope<"box.nest", { boxId: string; parentId: string | null; layout: DeviceKind; rect: GridRect }>
  | CommandEnvelope<"box.cutPaste", { boxId: string; targetViewId: string; layout: DeviceKind; rect: GridRect }>
  | CommandEnvelope<"box.clonePaste", { sourceBoxId: string; targetViewId: string; layout: DeviceKind; rect: GridRect; idMap: Record<string, string> }>
  | CommandEnvelope<"box.delete", { boxId: string }>
  | CommandEnvelope<"box.style.patch", { boxId: string; declarations?: Record<string, string | null>; scopedCss?: string }>;

export type CommandPayload<T extends WorkspaceCommand["type"]> = Extract<WorkspaceCommand, { type: T }>["payload"];

export interface WorkspaceEvent {
  commandId: string;
  revision: number;
  type: WorkspaceCommand["type"];
  payload: WorkspaceCommand["payload"];
}

export interface CommandResult {
  state: WorkspaceState;
  event: WorkspaceEvent;
}

export class DomainError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const CLONE_NAME_KEY = "box.cloneName";
const CLONE_NAME_NUMBERED_KEY = "box.cloneNameNumbered";
const DEFAULT_CLONE_NAME_TEMPLATES: CloneNameTemplates = {
  first: `${CLONE_NAME_KEY}:{name}`,
  numbered: `${CLONE_NAME_NUMBERED_KEY}:{name}:{count}`,
};

export function createWorkspace(input: {
  workspaceId: string;
  initialViewId: string;
  initialViewName: string;
  deviceNames?: DeviceNames;
  cloneNameTemplates?: CloneNameTemplates;
  initialLayout?: DeviceKind;
}): WorkspaceState {
  const workspaceId = requiredId(input.workspaceId);
  const initialViewId = requiredId(input.initialViewId);
  const initialViewName = normalizedName(input.initialViewName);
  const deviceNames = input.deviceNames ?? {
    desktop: "device.desktop",
    tablet: "device.tablet",
    mobile: "device.mobile",
  };
  const boxes: Record<string, BoxNode> = {};
  const localeMessages: Record<string, string> = {};
  addCloneNameTemplates(localeMessages, input.cloneNameTemplates ?? DEFAULT_CLONE_NAME_TEMPLATES);
  const viewBox = createSystemBox({
    id: systemViewBoxId(initialViewId),
    name: initialViewName,
    role: { type: "view", viewId: initialViewId },
    rect: viewControlRect(0),
  });
  boxes[viewBox.id] = viewBox;
  localeMessages[requiredLabelKey(viewBox)] = initialViewName;
  for (const [index, device] of (["desktop", "tablet", "mobile"] as const).entries()) {
    const box = createSystemBox({
      id: systemDeviceBoxId(device),
      name: normalizedName(deviceNames[device]),
      role: { type: "device", device },
      rect: { column: 6 + index * 6, row: 0, width: 6, height: 2 },
    });
    boxes[box.id] = box;
    localeMessages[requiredLabelKey(box)] = normalizedName(deviceNames[device]);
  }
  return {
    schemaVersion: 5,
    id: workspaceId,
    revision: 0,
    activeViewId: initialViewId,
    activeLayout: input.initialLayout ?? "desktop",
    deviceDefaults: { desktop: initialViewId, tablet: initialViewId, mobile: initialViewId },
    views: {
      [initialViewId]: {
        id: initialViewId,
        name: initialViewName,
        grid: { columns: 24, visible: false },
      },
    },
    boxes,
    preferences: { handlesVisible: true, namesVisible: true },
    localeMessages,
    globalStyle: { declarations: {}, scopedCss: "" },
  };
}

export function migrateWorkspaceV1(
  current: LegacyWorkspaceStateV1,
  deviceNames: DeviceNames,
  activeLayout: DeviceKind = "desktop",
  cloneNameTemplates: CloneNameTemplates = DEFAULT_CLONE_NAME_TEMPLATES,
): WorkspaceState {
  const boxes: Record<string, BoxNode> = Object.fromEntries(
    Object.values(current.boxes).map((box) => {
      const { rect, archived: _archived, ...rest } = structuredClone(box);
      return [box.id, {
        ...rest,
        viewId: box.viewId,
        labelKey: null,
        layoutRects: layoutRectsFrom(scaleRect(rect)),
        childGrid: { ...box.childGrid, columns: 24 },
        role: { type: "content" } as const,
        cloneSourceId: null,
        cloneOrdinal: null,
      }];
    }),
  );
  const views = Object.fromEntries(
    Object.values(current.views).map((view) => [view.id, {
      ...structuredClone(view),
      grid: { ...view.grid, columns: 24 },
    }]),
  );

  Object.values(views).forEach((view, index) => {
    const id = availableSystemId(systemViewBoxId(view.id), boxes);
    const name = availableBoxName(view.name, boxes);
    boxes[id] = createSystemBox({ id, name, role: { type: "view", viewId: view.id }, rect: viewControlRect(index) });
  });
  (["desktop", "tablet", "mobile"] as const).forEach((device, index) => {
    const id = availableSystemId(systemDeviceBoxId(device), boxes);
    const name = availableBoxName(deviceNames[device], boxes);
    boxes[id] = createSystemBox({
      id,
      name,
      role: { type: "device", device },
      rect: { column: 6 + index * 6, row: 0, width: 6, height: 2 },
    });
  });

  const localeMessages = localeMessagesFromBoxes(boxes);
  addCloneNameTemplates(localeMessages, cloneNameTemplates);

  return {
    schemaVersion: 5,
    id: current.id,
    revision: current.revision,
    activeViewId: current.activeViewId,
    activeLayout,
    deviceDefaults: deviceDefaultsWithFallback(current.deviceDefaults, current.activeViewId),
    views,
    boxes,
    preferences: { handlesVisible: true, namesVisible: true },
    localeMessages,
    globalStyle: structuredClone(current.globalStyle),
  };
}

export function migrateWorkspaceV2(
  current: LegacyWorkspaceStateV2,
  activeLayout: DeviceKind = "desktop",
  cloneNameTemplates: CloneNameTemplates = DEFAULT_CLONE_NAME_TEMPLATES,
): WorkspaceState {
  const boxes: Record<string, BoxNode> = Object.fromEntries(
    Object.values(current.boxes).map((box) => {
      const { rect, archived: _archived, ...rest } = structuredClone(box);
      return [box.id, {
        ...rest,
        labelKey: box.role.type === "content" ? null : systemBoxLabelKey(box.id),
        layoutRects: layoutRectsFrom(rect),
        cloneSourceId: null,
        cloneOrdinal: null,
      }];
    }),
  );
  const localeMessages = localeMessagesFromBoxes(boxes);
  addCloneNameTemplates(localeMessages, cloneNameTemplates);
  return {
    schemaVersion: 5,
    id: current.id,
    revision: current.revision,
    activeViewId: current.activeViewId,
    activeLayout,
    deviceDefaults: deviceDefaultsWithFallback(current.deviceDefaults, current.activeViewId),
    views: structuredClone(current.views),
    boxes,
    preferences: structuredClone(current.preferences),
    localeMessages,
    globalStyle: structuredClone(current.globalStyle),
  };
}

export function migrateWorkspaceV3(
  current: LegacyWorkspaceStateV3,
  cloneNameTemplates: CloneNameTemplates = DEFAULT_CLONE_NAME_TEMPLATES,
): WorkspaceState {
  const boxes: Record<string, BoxNode> = Object.fromEntries(
    Object.values(current.boxes).map((box) => {
      const { archived: _archived, ...rest } = structuredClone(box);
      return [box.id, {
        ...rest,
        labelKey: box.role.type === "content" ? null : systemBoxLabelKey(box.id),
        cloneSourceId: null,
        cloneOrdinal: null,
      }];
    }),
  );
  const localeMessages = localeMessagesFromBoxes(boxes);
  addCloneNameTemplates(localeMessages, cloneNameTemplates);
  return {
    schemaVersion: 5,
    id: current.id,
    revision: current.revision,
    activeViewId: current.activeViewId,
    activeLayout: current.activeLayout,
    deviceDefaults: structuredClone(current.deviceDefaults),
    views: structuredClone(current.views),
    boxes,
    preferences: structuredClone(current.preferences),
    localeMessages,
    globalStyle: structuredClone(current.globalStyle),
  };
}

export function migrateWorkspaceV4(
  current: LegacyWorkspaceStateV4,
  cloneNameTemplates: CloneNameTemplates = DEFAULT_CLONE_NAME_TEMPLATES,
): WorkspaceState {
  const boxes: Record<string, BoxNode> = Object.fromEntries(
    Object.values(current.boxes).map((box) => {
      const { archived: _archived, ...rest } = structuredClone(box);
      return [box.id, { ...rest, cloneSourceId: null, cloneOrdinal: null }];
    }),
  );
  const localeMessages = structuredClone(current.localeMessages);
  addCloneNameTemplates(localeMessages, cloneNameTemplates);
  return {
    schemaVersion: 5,
    id: current.id,
    revision: current.revision,
    activeViewId: current.activeViewId,
    activeLayout: current.activeLayout,
    deviceDefaults: structuredClone(current.deviceDefaults),
    views: structuredClone(current.views),
    boxes,
    preferences: structuredClone(current.preferences),
    localeMessages,
    globalStyle: structuredClone(current.globalStyle),
  };
}

export function applyWorkspaceCommand(current: WorkspaceState, command: WorkspaceCommand): CommandResult {
  if (command.expectedRevision !== current.revision) throw new DomainError("workspace.revision.conflict");
  requiredId(command.id);
  const state = structuredClone(current);

  switch (command.type) {
    case "view.create": {
      requiredId(command.payload.viewId);
      if (state.views[command.payload.viewId]) throw new DomainError("view.id.duplicate");
      assertUniqueViewName(state, command.payload.name);
      const boxId = systemViewBoxId(command.payload.viewId);
      if (state.boxes[boxId]) throw new DomainError("box.id.duplicate");
      assertUniqueBoxName(state, command.payload.name);
      const viewIndex = Object.keys(state.views).length;
      const name = normalizedName(command.payload.name);
      state.views[command.payload.viewId] = {
        id: command.payload.viewId,
        name,
        grid: { columns: 24, visible: false },
      };
      const box = createSystemBox({
        id: boxId,
        name,
        role: { type: "view", viewId: command.payload.viewId },
        rect: viewControlRect(viewIndex),
      });
      state.boxes[boxId] = box;
      state.localeMessages[requiredLabelKey(box)] = name;
      break;
    }
    case "view.activate": {
      requireView(state, command.payload.viewId);
      state.activeViewId = command.payload.viewId;
      break;
    }
    case "view.setDeviceDefault": {
      requireView(state, command.payload.viewId);
      state.deviceDefaults[command.payload.device] = command.payload.viewId;
      break;
    }
    case "layout.activate": {
      state.activeLayout = command.payload.device;
      break;
    }
    case "layout.copy": {
      if (command.payload.source === command.payload.target) throw new DomainError("layout.copy.same");
      requireView(state, command.payload.viewId);
      if (command.payload.boxId) {
        const box = requireBox(state, command.payload.boxId);
        if (box.viewId !== null && box.viewId !== command.payload.viewId) {
          throw new DomainError("layout.copy.viewMismatch");
        }
        box.layoutRects[command.payload.target] = { ...box.layoutRects[command.payload.source] };
      } else {
        Object.values(state.boxes)
          .filter((box) => box.viewId === null || box.viewId === command.payload.viewId)
          .forEach((box) => {
            box.layoutRects[command.payload.target] = { ...box.layoutRects[command.payload.source] };
          });
      }
      break;
    }
    case "grid.visibility.set": {
      requireView(state, command.payload.viewId).grid.visible = command.payload.visible;
      break;
    }
    case "workspace.handles.set": {
      state.preferences.handlesVisible = command.payload.visible;
      break;
    }
    case "workspace.names.set": {
      state.preferences.namesVisible = command.payload.visible;
      break;
    }
    case "localization.message.set": {
      const key = requiredId(command.payload.key);
      if (!Object.prototype.hasOwnProperty.call(state.localeMessages, key)) {
        throw new DomainError("localization.key.notFound");
      }
      state.localeMessages[key] = normalizedName(command.payload.value);
      if (key === CLONE_NAME_KEY || key === CLONE_NAME_NUMBERED_KEY) recomputeCloneNames(state);
      break;
    }
    case "box.create": {
      requiredId(command.payload.boxId);
      if (state.boxes[command.payload.boxId]) throw new DomainError("box.id.duplicate");
      const view = requireView(state, command.payload.viewId);
      assertUniqueBoxName(state, command.payload.name);
      const parent = command.payload.parentId ? requireBox(state, command.payload.parentId) : null;
      if (parent && parent.viewId !== view.id) throw new DomainError("box.parent.viewMismatch");
      assertRect(command.payload.rect, parent ? parent.childGrid.columns : null);
      state.boxes[command.payload.boxId] = {
        id: command.payload.boxId,
        viewId: view.id,
        parentId: parent?.id ?? null,
        name: normalizedName(command.payload.name),
        labelKey: null,
        layoutRects: layoutRectsFrom(command.payload.rect),
        childGrid: { columns: 24, visible: false },
        style: { declarations: {}, scopedCss: "" },
        role: { type: "content" },
        cloneSourceId: null,
        cloneOrdinal: null,
      };
      break;
    }
    case "box.rename": {
      const box = requireBox(state, command.payload.boxId);
      if (box.cloneSourceId) throw new DomainError("box.rename.clone");
      const name = normalizedName(command.payload.name);
      assertRenameWithClonesIsUnique(state, box, name);
      if (box.role.type === "view") {
        assertUniqueViewName(state, name, box.role.viewId);
        requireView(state, box.role.viewId).name = name;
      }
      box.name = name;
      renameLinkedClones(state, box.id, name);
      break;
    }
    case "box.move": {
      const box = requireBox(state, command.payload.boxId);
      const columns = parentColumns(state, box);
      const rect = { ...box.layoutRects[command.payload.layout], column: command.payload.column, row: command.payload.row };
      assertRect(rect, columns);
      box.layoutRects[command.payload.layout] = rect;
      break;
    }
    case "box.resize": {
      const box = requireBox(state, command.payload.boxId);
      assertRect(command.payload.rect, parentColumns(state, box));
      box.layoutRects[command.payload.layout] = { ...command.payload.rect };
      break;
    }
    case "box.nest": {
      const box = requireBox(state, command.payload.boxId);
      const parent = command.payload.parentId ? requireBox(state, command.payload.parentId) : null;
      if (parent && parent.viewId !== box.viewId) throw new DomainError("box.parent.viewMismatch");
      if (parent && (parent.id === box.id || isDescendant(state, parent.id, box.id))) throw new DomainError("box.parent.cycle");
      const columns = parent?.childGrid.columns ?? rootColumns(state, box);
      assertRect(command.payload.rect, columns);
      box.parentId = parent?.id ?? null;
      box.layoutRects[command.payload.layout] = { ...command.payload.rect };
      break;
    }
    case "box.cutPaste": {
      const box = requireContentBox(state, command.payload.boxId);
      const targetView = requireView(state, command.payload.targetViewId);
      assertRect(command.payload.rect, null);
      box.parentId = null;
      box.layoutRects[command.payload.layout] = { ...command.payload.rect };
      setViewForSubtree(state, box.id, targetView.id);
      break;
    }
    case "box.clonePaste": {
      const source = requireContentBox(state, command.payload.sourceBoxId);
      const targetView = requireView(state, command.payload.targetViewId);
      const sourceIds = [source.id, ...descendantIds(state, source.id)];
      assertCloneIdMap(state, sourceIds, command.payload.idMap);
      assertRect(command.payload.rect, null);
      for (const sourceId of sourceIds) {
        const sourceBox = requireContentBox(state, sourceId);
        const cloneId = command.payload.idMap[sourceId];
        const originId = sourceBox.cloneSourceId ?? sourceBox.id;
        const { name, ordinal } = nextCloneIdentity(state, originId);
        const clone = structuredClone(sourceBox);
        clone.id = cloneId;
        clone.viewId = targetView.id;
        clone.parentId = sourceId === source.id ? null : command.payload.idMap[sourceBox.parentId!];
        clone.name = name;
        clone.cloneSourceId = originId;
        clone.cloneOrdinal = ordinal;
        if (sourceId === source.id) clone.layoutRects[command.payload.layout] = { ...command.payload.rect };
        state.boxes[cloneId] = clone;
      }
      break;
    }
    case "box.delete": {
      const box = requireBox(state, command.payload.boxId);
      if (box.role.type !== "content") throw new DomainError("box.delete.protected");
      if (Object.values(state.boxes).some((candidate) => candidate.parentId === box.id)) {
        throw new DomainError("box.delete.hasChildren");
      }
      Object.values(state.boxes)
        .filter((candidate) => candidate.cloneSourceId === box.id)
        .forEach((candidate) => {
          candidate.cloneSourceId = null;
          candidate.cloneOrdinal = null;
        });
      delete state.boxes[box.id];
      break;
    }
    case "box.style.patch": {
      const box = requireBox(state, command.payload.boxId);
      for (const [property, value] of Object.entries(command.payload.declarations ?? {})) {
        const normalizedProperty = property.trim();
        if (!normalizedProperty) throw new DomainError("box.style.property.invalid");
        if (value === null) delete box.style.declarations[normalizedProperty];
        else box.style.declarations[normalizedProperty] = value;
      }
      if (command.payload.scopedCss !== undefined) box.style.scopedCss = command.payload.scopedCss;
      break;
    }
  }

  state.revision += 1;
  return {
    state,
    event: {
      commandId: command.id,
      revision: state.revision,
      type: command.type,
      payload: command.payload,
    },
  };
}

export function isProtectedBox(box: BoxNode) {
  return box.role.type !== "content";
}

function createSystemBox(input: { id: string; name: string; role: Exclude<BoxRole, { type: "content" }>; rect: GridRect }): BoxNode {
  return {
    id: input.id,
    viewId: null,
    parentId: null,
    name: input.name,
    labelKey: systemBoxLabelKey(input.id),
    layoutRects: layoutRectsFrom(input.rect),
    childGrid: { columns: 24, visible: false },
    style: { declarations: {}, scopedCss: "" },
    role: input.role,
    cloneSourceId: null,
    cloneOrdinal: null,
  };
}

function systemBoxLabelKey(boxId: string) {
  return `workspace.box.${boxId}.label`;
}

function requiredLabelKey(box: BoxNode) {
  if (!box.labelKey) throw new DomainError("localization.key.missing");
  return box.labelKey;
}

function localeMessagesFromBoxes(boxes: Record<string, BoxNode>) {
  return Object.fromEntries(
    Object.values(boxes)
      .filter((box): box is BoxNode & { labelKey: string } => box.labelKey !== null)
      .map((box) => [box.labelKey, box.name]),
  );
}

function addCloneNameTemplates(messages: Record<string, string>, templates: CloneNameTemplates) {
  messages[CLONE_NAME_KEY] = normalizedName(templates.first);
  messages[CLONE_NAME_NUMBERED_KEY] = normalizedName(templates.numbered);
}

function layoutRectsFrom(rect: GridRect): Record<DeviceKind, GridRect> {
  return {
    desktop: { ...rect },
    tablet: { ...rect },
    mobile: { ...rect },
  };
}

function deviceDefaultsWithFallback(
  defaults: Partial<Record<DeviceKind, string>>,
  fallbackViewId: string,
): Record<DeviceKind, string> {
  return {
    desktop: defaults.desktop ?? fallbackViewId,
    tablet: defaults.tablet ?? fallbackViewId,
    mobile: defaults.mobile ?? fallbackViewId,
  };
}

function systemViewBoxId(viewId: string) {
  return `system:view:${viewId}`;
}

function systemDeviceBoxId(device: DeviceKind) {
  return `system:device:${device}`;
}

function viewControlRect(index: number): GridRect {
  if (index === 0) return { column: 0, row: 0, width: 6, height: 2 };
  const offset = index - 1;
  return { column: (offset % 4) * 6, row: 2 + Math.floor(offset / 4) * 2, width: 6, height: 2 };
}

function scaleRect(rect: GridRect): GridRect {
  return { column: rect.column * 2, row: rect.row * 2, width: rect.width * 2, height: rect.height * 2 };
}

function availableSystemId(preferred: string, boxes: Record<string, BoxNode>) {
  let candidate = preferred;
  let suffix = 2;
  while (boxes[candidate]) candidate = `${preferred}:${suffix++}`;
  return candidate;
}

function availableBoxName(preferred: string, boxes: Record<string, BoxNode>) {
  const normalized = normalizedName(preferred);
  const occupied = new Set(Object.values(boxes).map((box) => canonicalName(box.name)));
  if (!occupied.has(canonicalName(normalized))) return normalized;
  let suffix = 2;
  while (occupied.has(canonicalName(`${normalized} ${suffix}`))) suffix += 1;
  return `${normalized} ${suffix}`;
}

function requiredId(value: string) {
  const id = value.trim();
  if (!id) throw new DomainError("id.required");
  return id;
}

function normalizedName(value: string) {
  const name = value.trim();
  if (!name) throw new DomainError("name.required");
  return name;
}

function canonicalName(value: string) {
  return normalizedName(value).toLocaleLowerCase("hu-HU");
}

function requireView(state: WorkspaceState, viewId: string) {
  const view = state.views[viewId];
  if (!view) throw new DomainError("view.notFound");
  return view;
}

function requireBox(state: WorkspaceState, boxId: string) {
  const box = state.boxes[boxId];
  if (!box) throw new DomainError("box.notFound");
  return box;
}

function requireContentBox(state: WorkspaceState, boxId: string) {
  const box = requireBox(state, boxId);
  if (box.role.type !== "content") throw new DomainError("box.content.required");
  return box;
}

function assertUniqueViewName(state: WorkspaceState, name: string, exceptId: string | null = null) {
  const candidate = canonicalName(name);
  if (Object.values(state.views).some((view) => view.id !== exceptId && canonicalName(view.name) === candidate)) {
    throw new DomainError("view.name.duplicate");
  }
}

function assertUniqueBoxName(state: WorkspaceState, name: string, exceptId: string | null = null) {
  const candidate = canonicalName(name);
  if (Object.values(state.boxes).some((box) => box.id !== exceptId && canonicalName(box.name) === candidate)) {
    throw new DomainError("box.name.duplicate");
  }
}

function assertRect(rect: GridRect, columns: number | null) {
  const values = [rect.column, rect.row, rect.width, rect.height];
  if (!values.every(Number.isInteger)) throw new DomainError("box.rect.integerRequired");
  if (rect.width < 1 || rect.height < 1) throw new DomainError("box.rect.invalid");
  if (columns !== null && (rect.column < 0 || rect.row < 0)) throw new DomainError("box.rect.invalid");
  if (columns !== null && rect.column + rect.width > columns) throw new DomainError("box.rect.outOfBounds");
}

function parentColumns(state: WorkspaceState, box: BoxNode) {
  return box.parentId ? requireBox(state, box.parentId).childGrid.columns : rootColumns(state, box);
}

function rootColumns(state: WorkspaceState, box: BoxNode) {
  if (box.viewId) requireView(state, box.viewId);
  else requireView(state, state.activeViewId);
  return null;
}

function isDescendant(state: WorkspaceState, candidateId: string, ancestorId: string) {
  let current: BoxNode | undefined = state.boxes[candidateId];
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = state.boxes[current.parentId];
  }
  return false;
}

function descendantIds(state: WorkspaceState, boxId: string): string[] {
  const children = Object.values(state.boxes).filter((box) => box.parentId === boxId);
  return children.flatMap((box) => [box.id, ...descendantIds(state, box.id)]);
}

function setViewForSubtree(state: WorkspaceState, boxId: string, viewId: string) {
  requireBox(state, boxId).viewId = viewId;
  Object.values(state.boxes)
    .filter((box) => box.parentId === boxId)
    .forEach((box) => setViewForSubtree(state, box.id, viewId));
}

function assertCloneIdMap(state: WorkspaceState, sourceIds: string[], idMap: Record<string, string>) {
  const mappedSourceIds = Object.keys(idMap);
  if (mappedSourceIds.length !== sourceIds.length || sourceIds.some((sourceId) => !idMap[sourceId])) {
    throw new DomainError("box.clone.idMap.invalid");
  }
  const cloneIds = Object.values(idMap).map(requiredId);
  if (new Set(cloneIds).size !== cloneIds.length || cloneIds.some((cloneId) => state.boxes[cloneId])) {
    throw new DomainError("box.id.duplicate");
  }
}

function nextCloneIdentity(state: WorkspaceState, originId: string) {
  const origin = requireContentBox(state, originId);
  if (origin.cloneSourceId) throw new DomainError("box.clone.origin.invalid");
  const occupiedOrdinals = Object.values(state.boxes)
    .filter((box) => box.cloneSourceId === originId && box.cloneOrdinal !== null)
    .map((box) => box.cloneOrdinal as number);
  let ordinal = Math.max(0, ...occupiedOrdinals) + 1;
  let name = cloneName(state, origin.name, ordinal);
  while (Object.values(state.boxes).some((box) => canonicalName(box.name) === canonicalName(name))) {
    ordinal += 1;
    name = cloneName(state, origin.name, ordinal);
  }
  return { name, ordinal };
}

function cloneName(state: WorkspaceState, sourceName: string, ordinal: number) {
  const template = state.localeMessages[ordinal === 1 ? CLONE_NAME_KEY : CLONE_NAME_NUMBERED_KEY];
  if (!template) throw new DomainError("localization.cloneName.missing");
  return normalizedName(template
    .replaceAll("{name}", sourceName)
    .replaceAll("{count}", String(ordinal)));
}

function linkedClones(state: WorkspaceState, sourceId: string) {
  return Object.values(state.boxes)
    .filter((box) => box.cloneSourceId === sourceId)
    .sort((left, right) => (left.cloneOrdinal ?? 0) - (right.cloneOrdinal ?? 0));
}

function assertRenameWithClonesIsUnique(state: WorkspaceState, source: BoxNode, name: string) {
  const clones = linkedClones(state, source.id);
  const affectedIds = new Set([source.id, ...clones.map((clone) => clone.id)]);
  const candidateNames = [name, ...clones.map((clone) => cloneName(state, name, clone.cloneOrdinal!))];
  const canonicalCandidates = candidateNames.map(canonicalName);
  if (new Set(canonicalCandidates).size !== canonicalCandidates.length) throw new DomainError("box.name.duplicate");
  if (Object.values(state.boxes).some((box) =>
    !affectedIds.has(box.id) && canonicalCandidates.includes(canonicalName(box.name)))) {
    throw new DomainError("box.name.duplicate");
  }
}

function renameLinkedClones(state: WorkspaceState, sourceId: string, sourceName: string) {
  linkedClones(state, sourceId).forEach((clone) => {
    clone.name = cloneName(state, sourceName, clone.cloneOrdinal!);
  });
}

function recomputeCloneNames(state: WorkspaceState) {
  const clonedState = structuredClone(state);
  const sources = Object.values(clonedState.boxes).filter((box) => box.cloneSourceId === null);
  for (const source of sources) {
    assertRenameWithClonesIsUnique(clonedState, source, source.name);
    renameLinkedClones(clonedState, source.id, source.name);
  }
  state.boxes = clonedState.boxes;
}
