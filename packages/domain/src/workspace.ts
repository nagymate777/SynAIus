export type DeviceKind = "desktop" | "tablet" | "mobile";

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

export interface BoxNode {
  id: string;
  viewId: string;
  parentId: string | null;
  name: string;
  rect: GridRect;
  childGrid: GridDefinition;
  style: BoxStyle;
  archived: boolean;
}

export interface WorkspaceView {
  id: string;
  name: string;
  grid: GridDefinition;
}

export interface WorkspaceState {
  schemaVersion: 1;
  id: string;
  revision: number;
  activeViewId: string;
  deviceDefaults: Partial<Record<DeviceKind, string>>;
  views: Record<string, WorkspaceView>;
  boxes: Record<string, BoxNode>;
  globalStyle: BoxStyle;
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
  | CommandEnvelope<"grid.visibility.set", { viewId: string; visible: boolean }>
  | CommandEnvelope<"box.create", { boxId: string; viewId: string; parentId: string | null; name: string; rect: GridRect }>
  | CommandEnvelope<"box.rename", { boxId: string; name: string }>
  | CommandEnvelope<"box.move", { boxId: string; column: number; row: number }>
  | CommandEnvelope<"box.resize", { boxId: string; rect: GridRect }>
  | CommandEnvelope<"box.nest", { boxId: string; parentId: string | null; rect: GridRect }>
  | CommandEnvelope<"box.archive", { boxId: string }>
  | CommandEnvelope<"box.restore", { boxId: string; parentId: string | null; rect: GridRect }>
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
}): WorkspaceState {
  const name = normalizedName(input.initialViewName);
  return {
    schemaVersion: 1,
    id: requiredId(input.workspaceId),
    revision: 0,
    activeViewId: requiredId(input.initialViewId),
    deviceDefaults: { desktop: input.initialViewId },
    views: {
      [input.initialViewId]: {
        id: input.initialViewId,
        name,
        grid: { columns: 12, visible: false },
      },
    },
    boxes: {},
    globalStyle: { declarations: {}, scopedCss: "" },
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
      state.views[command.payload.viewId] = {
        id: command.payload.viewId,
        name: normalizedName(command.payload.name),
        grid: { columns: 12, visible: false },
      };
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
    case "grid.visibility.set": {
      requireView(state, command.payload.viewId).grid.visible = command.payload.visible;
      break;
    }
    case "box.create": {
      requiredId(command.payload.boxId);
      if (state.boxes[command.payload.boxId]) throw new DomainError("box.id.duplicate");
      const view = requireView(state, command.payload.viewId);
      assertUniqueBoxName(state, command.payload.name);
      const parent = command.payload.parentId ? requireActiveBox(state, command.payload.parentId) : null;
      if (parent && parent.viewId !== view.id) throw new DomainError("box.parent.viewMismatch");
      assertRect(command.payload.rect, parent?.childGrid.columns ?? view.grid.columns);
      state.boxes[command.payload.boxId] = {
        id: command.payload.boxId,
        viewId: view.id,
        parentId: parent?.id ?? null,
        name: normalizedName(command.payload.name),
        rect: { ...command.payload.rect },
        childGrid: { columns: 12, visible: false },
        style: { declarations: {}, scopedCss: "" },
        archived: false,
      };
      break;
    }
    case "box.rename": {
      const box = requireBox(state, command.payload.boxId);
      assertUniqueBoxName(state, command.payload.name, box.id);
      box.name = normalizedName(command.payload.name);
      break;
    }
    case "box.move": {
      const box = requireActiveBox(state, command.payload.boxId);
      const columns = parentColumns(state, box);
      const rect = { ...box.rect, column: command.payload.column, row: command.payload.row };
      assertRect(rect, columns);
      box.rect = rect;
      break;
    }
    case "box.resize": {
      const box = requireActiveBox(state, command.payload.boxId);
      assertRect(command.payload.rect, parentColumns(state, box));
      box.rect = { ...command.payload.rect };
      break;
    }
    case "box.nest": {
      const box = requireActiveBox(state, command.payload.boxId);
      const parent = command.payload.parentId ? requireActiveBox(state, command.payload.parentId) : null;
      if (parent?.viewId !== undefined && parent.viewId !== box.viewId) throw new DomainError("box.parent.viewMismatch");
      if (parent && (parent.id === box.id || isDescendant(state, parent.id, box.id))) throw new DomainError("box.parent.cycle");
      const columns = parent?.childGrid.columns ?? requireView(state, box.viewId).grid.columns;
      assertRect(command.payload.rect, columns);
      box.parentId = parent?.id ?? null;
      box.rect = { ...command.payload.rect };
      break;
    }
    case "box.archive": {
      requireActiveBox(state, command.payload.boxId).archived = true;
      break;
    }
    case "box.restore": {
      const box = requireBox(state, command.payload.boxId);
      const parent = command.payload.parentId ? requireActiveBox(state, command.payload.parentId) : null;
      if (parent && parent.viewId !== box.viewId) throw new DomainError("box.parent.viewMismatch");
      if (parent && (parent.id === box.id || isDescendant(state, parent.id, box.id))) throw new DomainError("box.parent.cycle");
      assertRect(command.payload.rect, parent?.childGrid.columns ?? requireView(state, box.viewId).grid.columns);
      box.parentId = parent?.id ?? null;
      box.rect = { ...command.payload.rect };
      box.archived = false;
      break;
    }
    case "box.delete": {
      const box = requireBox(state, command.payload.boxId);
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

function requireActiveBox(state: WorkspaceState, boxId: string) {
  const box = requireBox(state, boxId);
  if (box.archived) throw new DomainError("box.archived");
  return box;
}

function assertUniqueViewName(state: WorkspaceState, name: string) {
  const candidate = canonicalName(name);
  if (Object.values(state.views).some((view) => canonicalName(view.name) === candidate)) {
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
  return box.parentId
    ? requireActiveBox(state, box.parentId).childGrid.columns
    : requireView(state, box.viewId).grid.columns;
}

function isDescendant(state: WorkspaceState, candidateId: string, ancestorId: string) {
  let current: BoxNode | undefined = state.boxes[candidateId];
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = state.boxes[current.parentId];
  }
  return false;
}
