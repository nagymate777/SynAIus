export type DeviceKind = "desktop" | "tablet" | "mobile";

export type DeviceNames = Record<DeviceKind, string>;

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
  archived: boolean;
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
  schemaVersion: 4;
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

export interface LegacyBoxNodeV1 extends Omit<BoxNode, "role" | "viewId" | "layoutRects" | "labelKey"> {
  viewId: string;
  rect: GridRect;
}

export interface LegacyWorkspaceStateV1 extends Omit<WorkspaceState, "schemaVersion" | "boxes" | "preferences" | "activeLayout" | "deviceDefaults" | "localeMessages"> {
  schemaVersion: 1;
  deviceDefaults: Partial<Record<DeviceKind, string>>;
  boxes: Record<string, LegacyBoxNodeV1>;
}

export interface LegacyBoxNodeV2 extends Omit<BoxNode, "layoutRects" | "labelKey"> {
  rect: GridRect;
}

export interface LegacyWorkspaceStateV2 extends Omit<WorkspaceState, "schemaVersion" | "boxes" | "activeLayout" | "deviceDefaults" | "localeMessages"> {
  schemaVersion: 2;
  deviceDefaults: Partial<Record<DeviceKind, string>>;
  boxes: Record<string, LegacyBoxNodeV2>;
}

export type LegacyBoxNodeV3 = Omit<BoxNode, "labelKey">;

export interface LegacyWorkspaceStateV3 extends Omit<WorkspaceState, "schemaVersion" | "boxes" | "localeMessages"> {
  schemaVersion: 3;
  boxes: Record<string, LegacyBoxNodeV3>;
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
  | CommandEnvelope<"grid.visibility.set", { viewId: string; visible: boolean }>
  | CommandEnvelope<"workspace.handles.set", { visible: boolean }>
  | CommandEnvelope<"workspace.names.set", { visible: boolean }>
  | CommandEnvelope<"localization.message.set", { key: string; value: string }>
  | CommandEnvelope<"box.create", { boxId: string; viewId: string; parentId: string | null; name: string; rect: GridRect }>
  | CommandEnvelope<"box.rename", { boxId: string; name: string }>
  | CommandEnvelope<"box.move", { boxId: string; layout: DeviceKind; column: number; row: number }>
  | CommandEnvelope<"box.resize", { boxId: string; layout: DeviceKind; rect: GridRect }>
  | CommandEnvelope<"box.nest", { boxId: string; parentId: string | null; layout: DeviceKind; rect: GridRect }>
  | CommandEnvelope<"box.archive", { boxId: string }>
  | CommandEnvelope<"box.restore", { boxId: string; parentId: string | null; layout: DeviceKind; rect: GridRect }>
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

export function createWorkspace(input: {
  workspaceId: string;
  initialViewId: string;
  initialViewName: string;
  deviceNames?: DeviceNames;
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
    schemaVersion: 4,
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
): WorkspaceState {
  const boxes: Record<string, BoxNode> = Object.fromEntries(
    Object.values(current.boxes).map((box) => {
      const { rect, ...rest } = structuredClone(box);
      return [box.id, {
        ...rest,
        viewId: box.viewId,
        labelKey: null,
        layoutRects: layoutRectsFrom(scaleRect(rect)),
        childGrid: { ...box.childGrid, columns: 24 },
        role: { type: "content" } as const,
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

  return {
    schemaVersion: 4,
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

export function migrateWorkspaceV2(current: LegacyWorkspaceStateV2, activeLayout: DeviceKind = "desktop"): WorkspaceState {
  const boxes: Record<string, BoxNode> = Object.fromEntries(
    Object.values(current.boxes).map((box) => {
      const { rect, ...rest } = structuredClone(box);
      return [box.id, {
        ...rest,
        labelKey: box.role.type === "content" ? null : systemBoxLabelKey(box.id),
        layoutRects: layoutRectsFrom(rect),
      }];
    }),
  );
  return {
    schemaVersion: 4,
    id: current.id,
    revision: current.revision,
    activeViewId: current.activeViewId,
    activeLayout,
    deviceDefaults: deviceDefaultsWithFallback(current.deviceDefaults, current.activeViewId),
    views: structuredClone(current.views),
    boxes,
    preferences: structuredClone(current.preferences),
    localeMessages: localeMessagesFromBoxes(boxes),
    globalStyle: structuredClone(current.globalStyle),
  };
}

export function migrateWorkspaceV3(current: LegacyWorkspaceStateV3): WorkspaceState {
  const boxes: Record<string, BoxNode> = Object.fromEntries(
    Object.values(current.boxes).map((box) => [box.id, {
      ...structuredClone(box),
      labelKey: box.role.type === "content" ? null : systemBoxLabelKey(box.id),
    }]),
  );
  return {
    schemaVersion: 4,
    id: current.id,
    revision: current.revision,
    activeViewId: current.activeViewId,
    activeLayout: current.activeLayout,
    deviceDefaults: structuredClone(current.deviceDefaults),
    views: structuredClone(current.views),
    boxes,
    preferences: structuredClone(current.preferences),
    localeMessages: localeMessagesFromBoxes(boxes),
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
      break;
    }
    case "box.create": {
      requiredId(command.payload.boxId);
      if (state.boxes[command.payload.boxId]) throw new DomainError("box.id.duplicate");
      const view = requireView(state, command.payload.viewId);
      assertUniqueBoxName(state, command.payload.name);
      const parent = command.payload.parentId ? requireSurfaceBox(state, command.payload.parentId, false) : null;
      if (parent && parent.viewId !== view.id) throw new DomainError("box.parent.viewMismatch");
      assertRect(command.payload.rect, parent?.childGrid.columns ?? view.grid.columns);
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
        archived: false,
      };
      break;
    }
    case "box.rename": {
      const box = requireBox(state, command.payload.boxId);
      assertUniqueBoxName(state, command.payload.name, box.id);
      if (box.role.type === "view") {
        assertUniqueViewName(state, command.payload.name, box.role.viewId);
        requireView(state, box.role.viewId).name = normalizedName(command.payload.name);
      }
      box.name = normalizedName(command.payload.name);
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
      const parent = command.payload.parentId ? requireSurfaceBox(state, command.payload.parentId, box.archived) : null;
      if (parent && parent.viewId !== box.viewId) throw new DomainError("box.parent.viewMismatch");
      if (parent && (parent.id === box.id || isDescendant(state, parent.id, box.id))) throw new DomainError("box.parent.cycle");
      const columns = parent?.childGrid.columns ?? rootColumns(state, box);
      assertRect(command.payload.rect, columns);
      box.parentId = parent?.id ?? null;
      box.layoutRects[command.payload.layout] = { ...command.payload.rect };
      break;
    }
    case "box.archive": {
      const box = requireSurfaceBox(state, command.payload.boxId, false);
      if (box.parentId && !requireBox(state, box.parentId).archived) box.parentId = null;
      setArchivedForSubtree(state, box.id, true);
      break;
    }
    case "box.restore": {
      const box = requireSurfaceBox(state, command.payload.boxId, true);
      const parent = command.payload.parentId ? requireSurfaceBox(state, command.payload.parentId, false) : null;
      if (parent && parent.viewId !== box.viewId) throw new DomainError("box.parent.viewMismatch");
      if (parent && (parent.id === box.id || isDescendant(state, parent.id, box.id))) throw new DomainError("box.parent.cycle");
      assertRect(command.payload.rect, parent?.childGrid.columns ?? rootColumns(state, box));
      box.parentId = parent?.id ?? null;
      box.layoutRects[command.payload.layout] = { ...command.payload.rect };
      setArchivedForSubtree(state, box.id, false);
      break;
    }
    case "box.delete": {
      const box = requireBox(state, command.payload.boxId);
      if (box.role.type !== "content") throw new DomainError("box.delete.protected");
      if (Object.values(state.boxes).some((candidate) => candidate.parentId === box.id)) {
        throw new DomainError("box.delete.hasChildren");
      }
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
    archived: false,
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

function requireSurfaceBox(state: WorkspaceState, boxId: string, archived: boolean) {
  const box = requireBox(state, boxId);
  if (box.archived !== archived) throw new DomainError(archived ? "box.notArchived" : "box.archived");
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

function assertRect(rect: GridRect, columns: number) {
  const values = [rect.column, rect.row, rect.width, rect.height];
  if (!values.every(Number.isInteger)) throw new DomainError("box.rect.integerRequired");
  if (rect.column < 0 || rect.row < 0 || rect.width < 1 || rect.height < 1) throw new DomainError("box.rect.invalid");
  if (rect.column + rect.width > columns) throw new DomainError("box.rect.outOfBounds");
}

function parentColumns(state: WorkspaceState, box: BoxNode) {
  return box.parentId ? requireBox(state, box.parentId).childGrid.columns : rootColumns(state, box);
}

function rootColumns(state: WorkspaceState, box: BoxNode) {
  return box.viewId ? requireView(state, box.viewId).grid.columns : requireView(state, state.activeViewId).grid.columns;
}

function isDescendant(state: WorkspaceState, candidateId: string, ancestorId: string) {
  let current: BoxNode | undefined = state.boxes[candidateId];
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = state.boxes[current.parentId];
  }
  return false;
}

function setArchivedForSubtree(state: WorkspaceState, boxId: string, archived: boolean) {
  requireBox(state, boxId).archived = archived;
  Object.values(state.boxes)
    .filter((box) => box.parentId === boxId)
    .forEach((box) => setArchivedForSubtree(state, box.id, archived));
}
