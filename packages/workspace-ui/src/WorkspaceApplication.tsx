import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  ReactNode,
} from "react";
import type { SynAIusApplicationManifest } from "@synaius/application";
import type {
  CatalogContentRendererDefinition,
  ContentInstance,
  ContentRegistry,
  JsonObject,
} from "@synaius/content";
import {
  applyWorkspaceCommand,
  createWorkspace,
  isProtectedBox,
  type BoxNode,
  type BuiltInDeviceKind,
  type CloneNameTemplates,
  type CommandPayload,
  type DeviceNames,
  type GridRect,
  type LayoutId,
  type WorkspaceCommand,
  type WorkspaceState,
} from "@synaius/domain";
import { createTranslator } from "@synaius/i18n";
import type {
  DurableWorkspaceEvent,
  WorkspaceControlGateway,
} from "@synaius/workspace-control";
import {
  gridDeltaFromClient,
  gridPointFromClient,
  moveRect,
  nearestGridPointFromClient,
  readGridMetrics,
  rectAtPoint,
  resizeRectFromEnd,
  resizeRectFromStart,
  type GridMetrics,
  type GridPoint,
} from "./grid-interaction";
import { loadWorkspace, saveWorkspace } from "./workspace-storage";
import {
  createWorkspaceSnapshot,
  loadWorkspaceSnapshots,
  parseWorkspaceExport,
  saveWorkspaceSnapshots,
  type WorkspaceSnapshot,
} from "./workspace-snapshots";
import {
  commitEditorState,
  createEditorState,
  redoEditorState,
  undoEditorState,
  type EditorState,
} from "./editor-history";
import {
  DEFAULT_CANVAS_VIEWPORT,
  canvasCellSize,
  canvasViewportKey,
  centerViewportOnRect,
  loadCanvasViewports,
  rootGridMetrics,
  saveCanvasViewports,
  zoomViewportAt,
  type CanvasViewport,
} from "./canvas-viewport";

type DragMode = "move" | "resize-start" | "resize-end";
type ContextMode =
  | "actions"
  | "rename"
  | "label"
  | "delete"
  | "add-layout"
  | "delete-layout"
  | "copy-layout"
  | "content-picker"
  | "content-settings"
  | "permissions"
  | "snapshots"
  | "import";
type ClipboardMode = "cut" | "clone";

interface DragState {
  boxId: string;
  mode: DragMode;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startRect: GridRect;
  previewRect: GridRect;
  metrics: GridMetrics;
}

interface PanDragState {
  pointerId: number;
  storageKey: string;
  startClientX: number;
  startClientY: number;
  startViewport: CanvasViewport;
  previewViewport: CanvasViewport;
}

interface BoxClipboard {
  mode: ClipboardMode;
  boxId: string;
}

interface ContextState {
  boxId: string | null;
  point: GridPoint;
  x: number;
  y: number;
  mode: ContextMode;
  draftName: string;
  draftLabel: string;
  sourceLayoutId: LayoutId;
  contentType: string | null;
  contentValues: Record<string, string>;
  errorKey: string | null;
}

type GridStyle = CSSProperties & { "--grid-columns": number };
type ContextMenuStyle = CSSProperties & { "--menu-top": string };
type CanvasStyle = CSSProperties & {
  "--grid-size": string;
  "--grid-offset-x": string;
  "--grid-offset-y": string;
};
type CanvasWorldStyle = CSSProperties & { transform: string };

export interface WorkspaceContentRenderContext {
  box: BoxNode;
  workspace: WorkspaceState;
  execute<T extends WorkspaceCommand["type"]>(type: T, payload: CommandPayload<T>): void;
  focusBox(boxId: string): void;
}

export interface WorkspaceApplicationProps {
  application: Readonly<SynAIusApplicationManifest>;
  contentRegistry?: ContentRegistry<ReactNode, WorkspaceContentRenderContext>;
  initializeWorkspace?: (workspace: WorkspaceState) => WorkspaceState;
  workspaceControl?: WorkspaceControlGateway;
}

export function WorkspaceApplication({
  application,
  contentRegistry,
  initializeWorkspace,
  workspaceControl,
}: WorkspaceApplicationProps) {
  const t = useMemo(() => createTranslator(application.localeMessages), [application]);
  const contentCatalog = useMemo(() => contentRegistry?.listCatalog() ?? [], [contentRegistry]);
  const deviceNames = useMemo<DeviceNames>(() => ({
    desktop: t("workspace.device.desktop"),
    tablet: t("workspace.device.tablet"),
    mobile: t("workspace.device.mobile"),
  }), [t]);
  const cloneNameTemplates = useMemo<CloneNameTemplates>(() => ({
    first: t("workspace.box.cloneName", { name: "{name}" }),
    numbered: t("workspace.box.cloneNameNumbered", { name: "{name}", count: "{count}" }),
  }), [t]);
  const [editor, setEditor] = useState<EditorState>(() => createEditorState(
    createInitialWorkspace(application, t, deviceNames, cloneNameTemplates, initializeWorkspace),
  ));
  const [controlStatus, setControlStatus] = useState<"local" | "connecting" | "live" | "error">(
    workspaceControl ? "connecting" : "local",
  );
  const workspace = editor.workspace;
  const activeView = workspace.views[workspace.activeViewId];
  const viewportStorageKey = canvasViewportKey(activeView.id, workspace.activeLayout);
  const [viewports, setViewports] = useState(() => loadCanvasViewports(application.storageNamespace));
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>(() =>
    loadWorkspaceSnapshots(deviceNames, workspace.activeLayout, cloneNameTemplates, application.storageNamespace));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [panDrag, setPanDrag] = useState<PanDragState | null>(null);
  const [clipboard, setClipboard] = useState<BoxClipboard | null>(null);
  const [context, setContext] = useState<ContextState | null>(null);
  const [focusedBoxId, setFocusedBoxId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panDragRef = useRef<PanDragState | null>(null);
  const rightButtonHeldRef = useRef(false);
  const suppressContextMenuRef = useRef(false);
  const suppressSystemClickRef = useRef(false);
  const focusTimerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef(workspace);
  const editorRef = useRef(editor);
  const controlReadyRef = useRef(!workspaceControl);
  const controlQueueRef = useRef(Promise.resolve());
  const controlRetryRef = useRef<number | null>(null);
  const controlMountedRef = useRef(true);
  const savedViewport = viewports[viewportStorageKey] ?? DEFAULT_CANVAS_VIEWPORT;
  const viewport = panDrag?.previewViewport ?? savedViewport;
  const viewportRef = useRef(viewport);
  workspaceRef.current = workspace;
  editorRef.current = editor;
  viewportRef.current = viewport;

  document.title = t(application.titleKey);

  useEffect(() => {
    if (!workspaceControl) return;
    let active = true;
    controlMountedRef.current = true;
    controlReadyRef.current = false;
    setControlStatus("connecting");

    const connect = () => {
      if (!active) return;
      workspaceControl.connect(workspaceRef.current, handleControlEvent)
        .then((snapshot) => {
          if (!active) return;
          adoptControlledWorkspace(snapshot.workspace, true);
          controlReadyRef.current = true;
          setControlStatus("live");
        })
        .catch(() => {
          if (!active) return;
          controlReadyRef.current = false;
          setControlStatus("error");
          controlRetryRef.current = window.setTimeout(connect, 2_000);
        });
    };
    connect();
    return () => {
      active = false;
      controlMountedRef.current = false;
      controlReadyRef.current = false;
      if (controlRetryRef.current !== null) window.clearTimeout(controlRetryRef.current);
      controlRetryRef.current = null;
      workspaceControl.close();
    };
  }, [workspaceControl]);

  useEffect(() => {
    saveWorkspace(workspace, application.storageNamespace);
  }, [application.storageNamespace, workspace]);

  useEffect(() => {
    saveWorkspaceSnapshots(snapshots, application.storageNamespace);
  }, [application.storageNamespace, snapshots]);

  useEffect(() => {
    saveCanvasViewports(viewports, application.storageNamespace);
  }, [application.storageNamespace, viewports]);

  useEffect(() => {
    if (clipboard && (!workspace.boxes[clipboard.boxId]
      || workspace.boxes[clipboard.boxId].role.type !== "content")) setClipboard(null);
  }, [clipboard, workspace.boxes]);

  useEffect(() => () => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
  }, []);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      if (dragRef.current?.pointerId === event.pointerId) {
        event.preventDefault();
        updateDragAt(event.clientX, event.clientY);
      } else if (panDragRef.current?.pointerId === event.pointerId) {
        event.preventDefault();
        updatePanAt(event.clientX, event.clientY);
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (dragRef.current?.pointerId === event.pointerId) finishDragAt(event.clientX, event.clientY);
      if (panDragRef.current?.pointerId === event.pointerId) finishPan();
      if (event.button === 2) rightButtonHeldRef.current = false;
    }

    function onMouseMove(event: MouseEvent) {
      if (!dragRef.current) return;
      event.preventDefault();
      updateDragAt(event.clientX, event.clientY);
    }

    function onMouseUp(event: MouseEvent) {
      if (!dragRef.current) return;
      finishDragAt(event.clientX, event.clientY);
    }

    function onPointerCancel() {
      cancelDrag();
      cancelPan();
      rightButtonHeldRef.current = false;
    }

    function onWindowBlur() {
      cancelDrag();
      cancelPan();
      rightButtonHeldRef.current = false;
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("mousemove", onMouseMove, { passive: false });
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || isTextEditingTarget(event.target)) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoWorkspace();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redoWorkspace();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function send<T extends WorkspaceCommand["type"]>(type: T, payload: CommandPayload<T>) {
    dispatchCommands([{ type, payload }], commandRecordsHistory(type));
  }

  function dispatchCommands(
    drafts: Array<{ type: WorkspaceCommand["type"]; payload: WorkspaceCommand["payload"] }>,
    recordHistory = true,
  ) {
    if (workspaceControl && !controlReadyRef.current) return;
    let nextWorkspace = workspaceRef.current;
    const commands: WorkspaceCommand[] = [];
    for (const draft of drafts) {
      const command = {
        id: crypto.randomUUID(),
        expectedRevision: nextWorkspace.revision,
        type: draft.type,
        payload: draft.payload,
      } as WorkspaceCommand;
      nextWorkspace = applyWorkspaceCommand(nextWorkspace, command).state;
      commands.push(command);
    }
    const nextEditor = commitEditorState(editorRef.current, () => nextWorkspace, recordHistory);
    workspaceRef.current = nextWorkspace;
    editorRef.current = nextEditor;
    setEditor(nextEditor);
    enqueueControlledCommands(commands);
  }

  function enqueueControlledCommands(commands: WorkspaceCommand[]) {
    if (!workspaceControl || commands.length === 0) return;
    const workspaceId = workspaceRef.current.id;
    controlQueueRef.current = controlQueueRef.current
      .then(async () => {
        for (const command of commands) {
          const result = await workspaceControl.execute(workspaceId, command);
          if (result.workspace.revision > workspaceRef.current.revision) {
            adoptControlledWorkspace(result.workspace);
          }
        }
        if (controlMountedRef.current) setControlStatus("live");
      })
      .catch(() => reconcileWorkspaceControl());
  }

  function handleControlEvent(event: DurableWorkspaceEvent) {
    const current = workspaceRef.current;
    if (event.workspaceId !== current.id || event.revision <= current.revision) return;
    if (event.revision !== current.revision + 1) {
      void reconcileWorkspaceControl();
      return;
    }
    try {
      const next = applyWorkspaceCommand(current, event.command).state;
      if (next.revision !== event.revision) throw new Error("workspace-control.event.revision.invalid");
      adoptControlledWorkspace(next);
    } catch {
      void reconcileWorkspaceControl();
    }
  }

  async function reconcileWorkspaceControl() {
    if (!workspaceControl || !controlMountedRef.current) return;
    controlReadyRef.current = false;
    setControlStatus("error");
    try {
      const snapshot = await workspaceControl.read(workspaceRef.current.id);
      if (!controlMountedRef.current) return;
      adoptControlledWorkspace(snapshot.workspace, true);
      controlReadyRef.current = true;
      setControlStatus("live");
    } catch {
      if (!controlMountedRef.current || controlRetryRef.current !== null) return;
      controlRetryRef.current = window.setTimeout(() => {
        controlRetryRef.current = null;
        void reconcileWorkspaceControl();
      }, 2_000);
    }
  }

  function adoptControlledWorkspace(next: WorkspaceState, force = false) {
    if (next.id !== workspaceRef.current.id) return;
    if (!force && next.revision <= workspaceRef.current.revision) return;
    const controlled = structuredClone(next);
    const nextEditor = createEditorState(controlled);
    workspaceRef.current = controlled;
    editorRef.current = nextEditor;
    setEditor(nextEditor);
  }

  function focusBox(boxId: string) {
    const currentWorkspace = workspaceRef.current;
    const requestedBox = currentWorkspace.boxes[boxId];
    if (!requestedBox) return;
    let rootBox = requestedBox;
    while (rootBox.parentId && currentWorkspace.boxes[rootBox.parentId]) {
      rootBox = currentWorkspace.boxes[rootBox.parentId];
    }
    const viewId = rootBox.viewId ?? currentWorkspace.activeViewId;
    const layout = currentWorkspace.activeLayout;
    const key = canvasViewportKey(viewId, layout);
    const canvas = canvasRef.current;
    if (canvas) {
      setViewports((stored) => ({
        ...stored,
        [key]: centerViewportOnRect(
          stored[key] ?? DEFAULT_CANVAS_VIEWPORT,
          rootBox.layoutRects[layout],
          canvas.clientWidth,
          canvas.clientHeight,
          canvasCellSize(canvas),
        ),
      }));
    }
    if (viewId !== currentWorkspace.activeViewId) send("view.activate", { viewId });
    setFocusedBoxId(boxId);
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      setFocusedBoxId((current) => current === boxId ? null : current);
      focusTimerRef.current = null;
    }, 1800);
  }

  function undoWorkspace() {
    applyHistoryTransition(undoEditorState(editorRef.current));
    setContext(null);
  }

  function redoWorkspace() {
    applyHistoryTransition(redoEditorState(editorRef.current));
    setContext(null);
  }

  function applyHistoryTransition(nextEditor: EditorState) {
    if (nextEditor === editorRef.current) return;
    if (workspaceControl && !controlReadyRef.current) return;
    const current = workspaceRef.current;
    const command = {
      id: crypto.randomUUID(),
      expectedRevision: current.revision,
      type: "workspace.restore",
      payload: { workspace: nextEditor.workspace },
    } as WorkspaceCommand;
    const nextWorkspace = applyWorkspaceCommand(current, command).state;
    const synchronizedEditor = { ...nextEditor, workspace: nextWorkspace };
    workspaceRef.current = nextWorkspace;
    editorRef.current = synchronizedEditor;
    setEditor(synchronizedEditor);
    enqueueControlledCommands([command]);
  }

  function copyLayout(target: LayoutId) {
    send("layout.copy", {
      source: workspace.activeLayout,
      target,
      viewId: activeView.id,
      boxId: contextBox?.id ?? null,
    });
    setContext(null);
  }

  function selectClipboard(mode: ClipboardMode, boxId: string) {
    const box = workspace.boxes[boxId];
    if (!box || box.role.type !== "content") return;
    setClipboard({ mode, boxId });
    setContext(null);
  }

  function pasteClipboard() {
    if (!clipboard || !context) return;
    const source = workspace.boxes[clipboard.boxId];
    if (!source || source.role.type !== "content") {
      setClipboard(null);
      setContext(null);
      return;
    }
    const sourceRect = source.layoutRects[workspace.activeLayout];
    const rect = rectAtPoint(context.point, sourceRect.width, sourceRect.height, null);
    if (clipboard.mode === "cut") {
      send("box.cutPaste", {
        boxId: source.id,
        targetViewId: activeView.id,
        layout: workspace.activeLayout,
        rect,
      });
      setClipboard(null);
    } else {
      const sourceIds = [source.id, ...descendantIds(workspace, source.id)];
      send("box.clonePaste", {
        sourceBoxId: source.id,
        targetViewId: activeView.id,
        layout: workspace.activeLayout,
        rect,
        idMap: Object.fromEntries(sourceIds.map((sourceId) => [sourceId, crypto.randomUUID()])),
      });
    }
    setContext(null);
  }

  function createSnapshot() {
    const name = nextAvailableName(t, "workspace.snapshot.generatedName", snapshots.map((snapshot) => snapshot.name));
    setSnapshots((current) => [createWorkspaceSnapshot(workspace, name), ...current].slice(0, 30));
    setContext(null);
  }

  function restoreSnapshot(snapshot: WorkspaceSnapshot) {
    send("workspace.restore", { workspace: snapshot.workspace });
    setContext(null);
  }

  function deleteSnapshot(snapshotId: string) {
    setSnapshots((current) => current.filter((snapshot) => snapshot.id !== snapshotId));
  }

  function exportWorkspace() {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = t("workspace.export.filename", { date: new Date().toISOString().slice(0, 10) });
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setContext(null);
  }

  async function importWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const imported = parseWorkspaceExport(
      await file.text(),
      deviceNames,
      workspace.activeLayout,
      cloneNameTemplates,
    );
    if (!imported) {
      setContext((current) => current ? { ...current, errorKey: "workspace.import.invalid" } : current);
      event.target.value = "";
      return;
    }
    send("workspace.restore", { workspace: imported });
    setContext(null);
  }

  const visibleBoxes = useMemo(
    () => Object.values(workspace.boxes).filter((box) =>
      (box.viewId === null || box.viewId === activeView.id)
      && (workspace.preferences.handlesVisible || !boxIsHiddenWhenLocked(workspace, box))),
    [activeView.id, workspace.boxes, workspace.preferences.handlesVisible],
  );
  const visibleBoxIds = useMemo(() => new Set(visibleBoxes.map((box) => box.id)), [visibleBoxes]);
  const visibleRootBoxes = useMemo(
    () => visibleBoxes.filter((box) => box.parentId === null || !visibleBoxIds.has(box.parentId)),
    [visibleBoxes, visibleBoxIds],
  );
  const contextBox = context?.boxId ? workspace.boxes[context.boxId] : null;
  const contextContent = contextBox?.contentId ? workspace.contents[contextBox.contentId] : null;
  const contextContentDefinition = contextContent && contentRegistry
    ? resolveCatalogDefinition(contentRegistry, contextContent.type, contextContent.rendererVersion)
    : null;
  const selectedContentDefinition = context?.mode === "content-picker" && context.contentType
    ? contentCatalog.find((definition) => definition.type === context.contentType) ?? null
    : null;
  const contextRequiredPermissions = requiredPermissionsFor(contextContentDefinition, contextContent);
  const contextGrantedPermissions = contextBox ? workspace.permissionGrants[contextBox.id] ?? [] : [];
  const contextBoxHasChildren = contextBox
    ? Object.values(workspace.boxes).some((box) => box.parentId === contextBox.id)
    : false;

  function addView() {
    const viewId = crypto.randomUUID();
    const name = nextAvailableName(t, "workspace.view.generatedName", Object.values(workspace.views).map((view) => view.name));
    dispatchCommands([
      { type: "view.create", payload: { viewId, name } },
      { type: "view.activate", payload: { viewId } },
    ]);
    setContext(null);
  }

  function addLayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context) return;
    const name = context.draftName.trim();
    if (!name || !workspace.layouts[context.sourceLayoutId]) return;
    const duplicate = Object.values(workspace.boxes).some((box) =>
      box.name.localeCompare(name, "hu", { sensitivity: "base" }) === 0);
    if (duplicate) return;
    send("layout.create", {
      layoutId: `custom:${crypto.randomUUID()}`,
      name,
      sourceLayoutId: context.sourceLayoutId,
    });
    setContext(null);
  }

  function addBox(parentId: string | null = null, point?: GridPoint) {
    const parent = parentId ? workspace.boxes[parentId] : null;
    const columns = parent?.childGrid.columns ?? null;
    const occupiedNames = Object.values(workspace.boxes).map((box) => box.name);
    const contentCount = Object.values(workspace.boxes).filter((box) => box.role.type === "content").length;
    const fallbackPoint = {
      column: (contentCount % 4) * 6,
      row: 3 + Math.floor(contentCount / 4) * 4,
    };
    send("box.create", {
      boxId: crypto.randomUUID(),
      viewId: workspace.activeViewId,
      parentId,
      name: nextAvailableName(t, "workspace.box.generatedName", occupiedNames),
      rect: rectAtPoint(point ?? fallbackPoint, 6, 4, columns),
    });
    setContext(null);
  }

  function openContentPicker() {
    if (!context || contentCatalog.length === 0) return;
    setContext({
      ...context,
      mode: "content-picker",
      draftName: "",
      contentType: null,
      contentValues: {},
      errorKey: null,
    });
  }

  function selectContentType(definition: CatalogContentRendererDefinition<ReactNode, WorkspaceContentRenderContext>) {
    if (!context) return;
    const occupiedNames = Object.values(workspace.boxes).map((box) => box.name);
    const defaultName = t(definition.catalog.defaultBoxNameKey);
    setContext({
      ...context,
      contentType: definition.type,
      draftName: nextAvailableLiteralName(t, defaultName, occupiedNames),
      contentValues: Object.fromEntries(definition.catalog.fields.map((field) => [
        field.key,
        String(definition.catalog.initialConfiguration[field.key] ?? ""),
      ])),
      errorKey: null,
    });
  }

  function addContentBox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !contentRegistry || !context.contentType) return;
    const definition = contentCatalog.find((entry) => entry.type === context.contentType);
    if (!definition) {
      setContext({ ...context, errorKey: "workspace.content.error.invalid" });
      return;
    }
    const name = context.draftName.trim();
    if (!name) {
      setContext({ ...context, errorKey: "workspace.content.error.required" });
      return;
    }
    const duplicate = Object.values(workspace.boxes).some((box) =>
      box.name.localeCompare(name, "hu", { sensitivity: "base" }) === 0);
    if (duplicate) {
      setContext({ ...context, errorKey: "workspace.content.error.duplicateName" });
      return;
    }
    if (definition.catalog.fields.some((field) => field.required && !context.contentValues[field.key]?.trim())) {
      setContext({ ...context, errorKey: "workspace.content.error.required" });
      return;
    }

    const configuration = structuredClone(definition.catalog.initialConfiguration) as JsonObject;
    for (const field of definition.catalog.fields) {
      configuration[field.key] = context.contentValues[field.key]?.trim() ?? "";
    }
    try {
      const instance = contentRegistry.createInstance({
        id: `content:${crypto.randomUUID()}`,
        type: definition.type,
        rendererVersion: definition.version,
        configuration,
        requiredPermissions: [...definition.catalog.requiredPermissions],
        sourceNodeId: null,
      });
      const { revision: _revision, ...content } = instance;
      const parentId = contextBox?.role.type === "content" ? contextBox.id : null;
      const point = parentId ? { column: 0, row: 0 } : context.point;
      send("content.box.create", {
        content,
        boxId: `box:${crypto.randomUUID()}`,
        viewId: workspace.activeViewId,
        parentId,
        name,
        rect: rectAtPoint(
          point,
          definition.catalog.defaultWidth,
          definition.catalog.defaultHeight,
          parentId ? workspace.boxes[parentId]?.childGrid.columns ?? null : null,
        ),
      });
      setContext(null);
    } catch {
      setContext({ ...context, errorKey: "workspace.content.error.invalid" });
    }
  }

  function openContentSettings() {
    if (!context || !contextContent || !contextContentDefinition?.catalog.fields.length) return;
    setContext({
      ...context,
      mode: "content-settings",
      contentType: contextContent.type,
      contentValues: contentFieldValues(contextContentDefinition, contextContent.configuration),
      errorKey: null,
    });
  }

  function saveContentSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !contentRegistry || !contextContent || !contextContentDefinition) return;
    if (contextContentDefinition.catalog.fields.some(
      (field) => field.required && !context.contentValues[field.key]?.trim(),
    )) {
      setContext({ ...context, errorKey: "workspace.content.error.required" });
      return;
    }

    const configuration = structuredClone(contextContent.configuration) as JsonObject;
    for (const field of contextContentDefinition.catalog.fields) {
      configuration[field.key] = context.contentValues[field.key]?.trim() ?? "";
    }
    try {
      const { revision: _revision, ...content } = contextContent;
      contentRegistry.createInstance({ ...content, configuration });
      send("content.configure", { contentId: contextContent.id, configuration });
      setContext(null);
    } catch {
      setContext({ ...context, errorKey: "workspace.content.error.invalid" });
    }
  }

  function openPermissionManager() {
    if (!context || !contextBox || contextRequiredPermissions.length === 0) return;
    setContext({ ...context, mode: "permissions", errorKey: null });
  }

  function openPermissionManagerForBox(event: ReactMouseEvent<HTMLButtonElement>, box: BoxNode) {
    event.stopPropagation();
    setContext({
      boxId: box.id,
      point: { column: 0, row: 0 },
      ...menuPosition(event.clientX, event.clientY),
      mode: "permissions",
      draftName: box.name,
      draftLabel: localizedBoxLabel(workspace, box),
      sourceLayoutId: workspace.activeLayout,
      contentType: null,
      contentValues: {},
      errorKey: null,
    });
  }

  function setBoxPermissions(boxId: string, permissions: string[]) {
    send("box.permissions.set", { boxId, permissions });
  }

  function renderContentFields(
    definition: CatalogContentRendererDefinition<ReactNode, WorkspaceContentRenderContext>,
  ) {
    if (!context) return null;
    return definition.catalog.fields.map((field) => (
      <label key={field.key} htmlFor={`content-field-${field.key}`}>
        {t(field.labelKey)}
        {field.input === "textarea" ? (
          <textarea
            id={`content-field-${field.key}`}
            rows={3}
            required={field.required}
            placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
            value={context.contentValues[field.key] ?? ""}
            onChange={(event) => setContext({
              ...context,
              contentValues: { ...context.contentValues, [field.key]: event.target.value },
              errorKey: null,
            })}
          />
        ) : (
          <input
            id={`content-field-${field.key}`}
            type={field.input === "url" ? "url" : "text"}
            required={field.required}
            placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
            value={context.contentValues[field.key] ?? ""}
            onChange={(event) => setContext({
              ...context,
              contentValues: { ...context.contentValues, [field.key]: event.target.value },
              errorKey: null,
            })}
          />
        )}
      </label>
    ));
  }

  function openCanvasContext(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false;
      return;
    }
    if (!canvasRef.current) return;
    const metrics = rootGridMetrics(canvasRef.current, viewportRef.current, canvasCellSize(canvasRef.current));
    setContext({
      boxId: null,
      point: nearestGridPointFromClient(metrics, event.clientX, event.clientY),
      ...menuPosition(event.clientX, event.clientY),
      mode: "actions",
      draftName: "",
      draftLabel: "",
      sourceLayoutId: workspace.activeLayout,
      contentType: null,
      contentValues: {},
      errorKey: null,
    });
  }

  function openBoxContext(event: ReactMouseEvent<HTMLElement>, box: BoxNode) {
    event.preventDefault();
    event.stopPropagation();
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false;
      return;
    }
    if (!canvasRef.current) return;
    const metrics = rootGridMetrics(canvasRef.current, viewportRef.current, canvasCellSize(canvasRef.current));
    setContext({
      boxId: box.id,
      point: nearestGridPointFromClient(metrics, event.clientX, event.clientY),
      ...menuPosition(event.clientX, event.clientY),
      mode: "actions",
      draftName: box.name,
      draftLabel: localizedBoxLabel(workspace, box),
      sourceLayoutId: workspace.activeLayout,
      contentType: null,
      contentValues: {},
      errorKey: null,
    });
  }

  function renameBox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contextBox) return;
    const name = context?.draftName.trim() ?? "";
    const duplicate = Object.values(workspace.boxes).some(
      (box) => box.id !== contextBox.id && box.name.localeCompare(name, "hu", { sensitivity: "base" }) === 0,
    );
    if (!name || duplicate) return;
    send("box.rename", { boxId: contextBox.id, name });
    setContext(null);
  }

  function editBoxLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contextBox?.labelKey) return;
    const value = context?.draftLabel.trim() ?? "";
    if (!value) return;
    send("localization.message.set", { key: contextBox.labelKey, value });
    setContext(null);
  }

  function beginCanvasPointer(event: ReactPointerEvent<HTMLElement>) {
    if (event.button === 2) {
      rightButtonHeldRef.current = true;
      suppressContextMenuRef.current = false;
      return;
    }
    if (event.button !== 0 || (event.target as HTMLElement).closest(".canvas-box")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextPan: PanDragState = {
      pointerId: event.pointerId,
      storageKey: viewportStorageKey,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewport: viewportRef.current,
      previewViewport: viewportRef.current,
    };
    panDragRef.current = nextPan;
    setPanDrag(nextPan);
    setContext(null);
  }

  function updatePanAt(clientX: number, clientY: number) {
    const current = panDragRef.current;
    if (!current) return;
    const previewViewport = {
      ...current.startViewport,
      panX: current.startViewport.panX + clientX - current.startClientX,
      panY: current.startViewport.panY + clientY - current.startClientY,
    };
    const nextPan = { ...current, previewViewport };
    panDragRef.current = nextPan;
    setPanDrag(nextPan);
  }

  function finishPan() {
    const current = panDragRef.current;
    if (!current) return;
    panDragRef.current = null;
    setPanDrag(null);
    setViewports((stored) => ({ ...stored, [current.storageKey]: current.previewViewport }));
  }

  function cancelPan() {
    panDragRef.current = null;
    setPanDrag(null);
  }

  function zoomCanvas(event: ReactWheelEvent<HTMLElement>) {
    if (!rightButtonHeldRef.current || !canvasRef.current) return;
    event.preventDefault();
    suppressContextMenuRef.current = true;
    const bounds = canvasRef.current.getBoundingClientRect();
    const next = zoomViewportAt(
      viewportRef.current,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      event.deltaY,
    );
    viewportRef.current = next;
    setViewports((stored) => ({ ...stored, [viewportStorageKey]: next }));
  }

  function beginBoxMove(event: ReactPointerEvent<HTMLElement>, box: BoxNode) {
    if (!workspace.preferences.handlesVisible) return;
    const target = event.target as HTMLElement;
    if (target.closest(".handle")) return;
    const interactive = target.closest("button, input, textarea, select, a, [contenteditable='true']");
    if (interactive && !target.closest(".system-box-action")) return;
    beginDrag(event, box, "move");
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, box: BoxNode, mode: DragMode) {
    if (event.button !== 0) return;
    const grid = box.parentId ? findGridElement(box.parentId) : canvasRef.current;
    if (!grid) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const parent = box.parentId ? workspace.boxes[box.parentId] : null;
    const rect = box.layoutRects[workspace.activeLayout];
    const nextDrag: DragState = {
      boxId: box.id,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: rect,
      previewRect: rect,
      metrics: parent
        ? readGridMetrics(grid, parent.childGrid.columns)
        : rootGridMetrics(grid, viewportRef.current, canvasCellSize(grid)),
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
    setContext(null);
  }

  function updateDragAt(clientX: number, clientY: number) {
    const current = dragRef.current;
    if (!current) return;
    const delta = gridDeltaFromClient(
      current.metrics,
      current.startClientX,
      current.startClientY,
      clientX,
      clientY,
    );
    const previewRect = current.mode === "move"
      ? moveRect(current.startRect, delta, current.metrics.columns)
      : current.mode === "resize-start"
        ? resizeRectFromStart(current.startRect, delta, current.metrics.columns)
        : resizeRectFromEnd(current.startRect, delta, current.metrics.columns);
    const nextDrag = { ...current, previewRect };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }

  function finishDragAt(clientX: number, clientY: number) {
    const current = dragRef.current;
    if (!current) return;
    dragRef.current = null;
    setDrag(null);

    const currentWorkspace = workspaceRef.current;
    const box = currentWorkspace.boxes[current.boxId];
    if (!box) return;
    const layout = currentWorkspace.activeLayout;
    const boxRect = box.layoutRects[layout];
    const changed = !sameRect(current.startRect, current.previewRect);
    if (current.mode === "move" && !changed) return;
    if (current.mode === "move") {
      suppressSystemClickRef.current = true;
      window.setTimeout(() => {
        suppressSystemClickRef.current = false;
      }, 0);
    }
    if (current.mode !== "move") {
      send("box.resize", { boxId: box.id, layout, rect: current.previewRect });
      return;
    }

    const targetParentId = findDropParentId(currentWorkspace, box, clientX, clientY);
    if (targetParentId && targetParentId !== box.parentId) {
      const targetParent = currentWorkspace.boxes[targetParentId];
      const targetGrid = findGridElement(targetParentId);
      if (targetParent && targetGrid) {
        const metrics = readGridMetrics(targetGrid, targetParent.childGrid.columns);
        send("box.nest", {
          boxId: box.id,
          parentId: targetParentId,
          layout,
          rect: rectAtPoint(
            gridPointFromClient(metrics, clientX, clientY),
            boxRect.width,
            boxRect.height,
            targetParent.childGrid.columns,
          ),
        });
        return;
      }
    }

    if (!targetParentId && box.parentId !== null && canvasRef.current && pointIsInside(canvasRef.current, clientX, clientY)) {
      const metrics = rootGridMetrics(canvasRef.current, viewportRef.current, canvasCellSize(canvasRef.current));
      send("box.nest", {
        boxId: box.id,
        parentId: null,
        layout,
        rect: rectAtPoint(
          gridPointFromClient(metrics, clientX, clientY),
          boxRect.width,
          boxRect.height,
          null,
        ),
      });
      return;
    }

    send("box.move", {
      boxId: box.id,
      layout,
      column: current.previewRect.column,
      row: current.previewRect.row,
    });
  }

  function cancelDrag() {
    dragRef.current = null;
    setDrag(null);
  }

  function findDropParentId(currentWorkspace: WorkspaceState, box: BoxNode, clientX: number, clientY: number) {
    const forbidden = new Set([box.id, ...descendantIds(currentWorkspace, box.id)]);
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const candidate = element.closest<HTMLElement>("[data-box-id]");
      const candidateId = candidate?.dataset.boxId;
      const target = candidateId ? currentWorkspace.boxes[candidateId] : null;
      if (target
        && !forbidden.has(target.id)
        && target.role.type === "content"
        && target.viewId === box.viewId) return target.id;
    }
    return null;
  }

  function activateSystemBox(box: BoxNode) {
    if (box.role.type === "view") send("view.activate", { viewId: box.role.viewId });
    if (box.role.type === "device") send("layout.activate", { layoutId: box.role.device });
  }

  function systemBoxSelected(box: BoxNode) {
    if (box.role.type === "view") return box.role.viewId === activeView.id;
    if (box.role.type === "device") return workspace.activeLayout === box.role.device;
    return false;
  }

  function renderBox(box: BoxNode) {
    const children = visibleBoxes.filter((candidate) => candidate.parentId === box.id);
    const renderedRect = drag?.boxId === box.id ? drag.previewRect : box.layoutRects[workspace.activeLayout];
    const label = localizedBoxLabel(workspace, box);
    const content = box.contentId ? workspace.contents[box.contentId] : null;
    const contentDefinition = content && contentRegistry
      ? resolveCatalogDefinition(contentRegistry, content.type, content.rendererVersion)
      : null;
    const requiredPermissions = requiredPermissionsFor(contentDefinition, content);
    const grantedPermissions = workspace.permissionGrants[box.id] ?? [];
    const missingPermissions = requiredPermissions.filter((permission) => !grantedPermissions.includes(permission));
    const validContent = content && contentRegistry ? contentRegistry.validate(content) : false;
    const geometry: CSSProperties = box.parentId
      ? {
          gridColumn: `${renderedRect.column + 1} / span ${renderedRect.width}`,
          gridRow: `${renderedRect.row + 1} / span ${renderedRect.height}`,
        }
      : {
          position: "absolute",
          left: `calc(${renderedRect.column} * var(--cell-size))`,
          top: `calc(${renderedRect.row} * var(--cell-size))`,
          width: `calc(${renderedRect.width} * var(--cell-size))`,
          height: `calc(${renderedRect.height} * var(--cell-size))`,
        };
    return (
      <article
        className="canvas-box"
        data-box-id={box.id}
        data-box-role={box.role.type}
        data-dragging={drag?.boxId === box.id}
        data-focused={focusedBoxId === box.id}
        data-clipboard-mode={clipboard?.boxId === box.id ? clipboard.mode : undefined}
        data-hidden-when-locked={box.hiddenWhenLocked}
        key={box.id}
        onContextMenu={(event) => openBoxContext(event, box)}
        onPointerDown={(event) => beginBoxMove(event, box)}
        style={{
          ...geometry,
          ...box.style.declarations,
        }}
      >
        <button
          className="handle handle-start"
          aria-label={t("workspace.box.handle.start")}
          onPointerDown={(event) => beginDrag(event, box, "resize-start")}
        />
        <strong className="box-name">{box.name}</strong>
        {workspace.preferences.handlesVisible && box.hiddenWhenLocked && (
          <span className="box-visibility-state">{t("workspace.box.hiddenWhenLocked")}</span>
        )}
        {box.role.type !== "content" && (
          <button
            className="system-box-action"
            aria-label={label}
            aria-pressed={systemBoxSelected(box)}
            data-language-key={box.labelKey ?? undefined}
            onClick={() => {
              if (suppressSystemClickRef.current) return;
              activateSystemBox(box);
            }}
          >
            <span className="system-box-state" aria-hidden="true">{systemBoxSelected(box) ? "●" : "○"}</span>
            <span className="system-box-label">{label}</span>
          </button>
        )}
        {box.role.type === "content" && content && contentRegistry && (
          <div className="box-content" data-content-id={content.id}>
            {!validContent ? (
              <div className="content-permission-gate" role="alert">
                <strong>{t("workspace.content.invalid.title")}</strong>
                <p>{t("workspace.content.invalid.description")}</p>
              </div>
            ) : missingPermissions.length > 0 ? (
              <div
                className="content-permission-gate"
                data-missing-permissions={missingPermissions.length}
                role="alert"
              >
                <strong>{t("workspace.permission.blocked.title")}</strong>
                <p>{t("workspace.permission.blocked.description", { count: missingPermissions.length })}</p>
                <ul>
                  {missingPermissions.map((permission) => {
                    const definition = contentDefinition?.catalog.permissions
                      .find((candidate) => candidate.id === permission);
                    return (
                      <li key={permission}>
                        {t(definition?.titleKey ?? "workspace.permission.unknown.title", { permission })}
                      </li>
                    );
                  })}
                </ul>
                <button type="button" onClick={(event) => openPermissionManagerForBox(event, box)}>
                  {t("workspace.permission.manage")}
                </button>
              </div>
            ) : contentRegistry.render(content, {
              box,
              workspace,
              execute: send,
              focusBox,
            })}
          </div>
        )}
        <div
          className="box-children"
          data-child-grid={box.id}
          style={{ "--grid-columns": box.childGrid.columns } as GridStyle}
        >
          {children.map(renderBox)}
        </div>
        <button
          className="handle handle-end"
          aria-label={t("workspace.box.handle.end")}
          onPointerDown={(event) => beginDrag(event, box, "resize-end")}
        />
      </article>
    );
  }

  return (
    <main
      className="portal-shell"
      data-handles-visible={workspace.preferences.handlesVisible}
      data-names-visible={workspace.preferences.namesVisible}
      data-layout={workspace.activeLayout}
      data-control-status={controlStatus}
      data-control-ready={!workspaceControl || controlStatus === "live"}
    >
      {workspaceControl && (
        <div className="workspace-control-status" role="status">
          {t(`workspace.control.${controlStatus}`)}
        </div>
      )}
      <section
        className="canvas"
        data-grid-visible={activeView.grid.visible}
        data-panning={panDrag !== null}
        style={{
          "--grid-size": `calc(var(--cell-size) * ${viewport.zoom})`,
          "--grid-offset-x": `${viewport.panX}px`,
          "--grid-offset-y": `${viewport.panY}px`,
        } as CanvasStyle}
        aria-label={t("workspace.canvas.label")}
        onContextMenu={openCanvasContext}
        onPointerDown={beginCanvasPointer}
        onWheel={zoomCanvas}
        ref={canvasRef}
      >
        <div
          className="canvas-world"
          style={{ transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})` } as CanvasWorldStyle}
        >
          {visibleRootBoxes.map(renderBox)}
        </div>
      </section>

      {context && (
        <>
          <div className="context-backdrop" aria-hidden="true" onPointerDown={() => setContext(null)} />
          <aside
            className="context-menu"
            key={context.mode}
            role="menu"
            style={{ left: context.x, top: context.y, "--menu-top": `${context.y}px` } as ContextMenuStyle}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {context.mode === "actions" && (
              <>
                {workspace.preferences.handlesVisible && clipboard && (
                  <button role="menuitem" onClick={pasteClipboard}>
                    {t(clipboard.mode === "cut" ? "workspace.action.pasteCut" : "workspace.action.pasteClone")}
                  </button>
                )}
                {workspace.preferences.handlesVisible && clipboard && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setClipboard(null);
                      setContext(null);
                    }}
                  >
                    {t(clipboard.mode === "cut" ? "workspace.action.cancelCut" : "workspace.action.cancelClone")}
                  </button>
                )}
                {workspace.preferences.handlesVisible && (
                  <button
                    role="menuitem"
                    onClick={() => addBox(
                      contextBox?.role.type === "content" ? contextBox.id : null,
                      contextBox?.role.type === "content" ? { column: 0, row: 0 } : context.point,
                    )}
                  >
                    {t(contextBox?.role.type === "content"
                      ? "workspace.context.addEmptyInside"
                      : "workspace.action.addEmptyBox")}
                  </button>
                )}
                {workspace.preferences.handlesVisible && contentCatalog.length > 0 && (
                  <button role="menuitem" onClick={openContentPicker}>
                    {t(contextBox?.role.type === "content"
                      ? "workspace.context.addContentInside"
                      : "workspace.action.addContentBox")}
                  </button>
                )}
                {workspace.preferences.handlesVisible && (
                  <>
                    <button role="menuitem" onClick={addView}>{t("workspace.action.addView")}</button>
                    <button
                      role="menuitem"
                      onClick={() => setContext({
                        ...context,
                        mode: "add-layout",
                        draftName: nextAvailableName(t,
                          "workspace.layout.generatedName",
                          Object.values(workspace.layouts).map((layout) => layout.name),
                        ),
                        sourceLayoutId: workspace.activeLayout,
                      })}
                    >
                      {t("workspace.action.addLayout")}
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        send("grid.visibility.set", { viewId: activeView.id, visible: !activeView.grid.visible });
                        setContext(null);
                      }}
                    >
                      {t(activeView.grid.visible ? "workspace.action.hideGrid" : "workspace.action.showGrid")}
                    </button>
                    <button role="menuitem" disabled={editor.undo.length === 0} onClick={undoWorkspace}>
                      {t("workspace.action.undo")}
                    </button>
                    <button role="menuitem" disabled={editor.redo.length === 0} onClick={redoWorkspace}>
                      {t("workspace.action.redo")}
                    </button>
                    <button role="menuitem" onClick={() => setContext({ ...context, mode: "copy-layout" })}>
                      {t(contextBox ? "workspace.action.copyBoxLayout" : "workspace.action.copyViewLayout")}
                    </button>
                  </>
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    const visible = !workspace.preferences.handlesVisible;
                    send("workspace.handles.set", { visible });
                    if (!visible) setClipboard(null);
                    setContext(null);
                  }}
                >
                  {t(workspace.preferences.handlesVisible ? "workspace.action.lockEditing" : "workspace.action.unlockEditing")}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    send("workspace.names.set", { visible: !workspace.preferences.namesVisible });
                    setContext(null);
                  }}
                >
                  {t(workspace.preferences.namesVisible ? "workspace.action.hideNames" : "workspace.action.showNames")}
                </button>
                <button role="menuitem" onClick={createSnapshot}>{t("workspace.action.createSnapshot")}</button>
                <button role="menuitem" onClick={() => setContext({ ...context, mode: "snapshots" })}>
                  {t("workspace.action.manageSnapshots", { count: snapshots.length })}
                </button>
                <button role="menuitem" onClick={exportWorkspace}>{t("workspace.action.exportWorkspace")}</button>
                {workspace.preferences.handlesVisible && (
                  <button role="menuitem" onClick={() => setContext({ ...context, mode: "import", errorKey: null })}>
                    {t("workspace.action.importWorkspace")}
                  </button>
                )}

                {workspace.preferences.handlesVisible && contextBox && (
                  <>
                    {contextBox.role.type === "view" && (
                      <button
                        role="menuitem"
                        aria-pressed={workspace.deviceDefaults[workspace.activeLayout] === contextBox.role.viewId}
                        onClick={() => {
                          if (contextBox.role.type !== "view") return;
                          send("view.setLayoutDefault", {
                            layoutId: workspace.activeLayout,
                            viewId: contextBox.role.viewId,
                          });
                          setContext(null);
                        }}
                      >
                        {t("workspace.action.setDefaultView", { layout: localizedLayoutLabel(workspace, workspace.activeLayout) })}
                      </button>
                    )}
                    {!contextBox.cloneSourceId && (
                      <button role="menuitem" onClick={() => setContext({ ...context, mode: "rename" })}>
                        {t("workspace.action.renameBox")}
                      </button>
                    )}
                    {contextBox.labelKey && (
                      <button role="menuitem" onClick={() => setContext({ ...context, mode: "label" })}>
                        {t("workspace.action.editBoxLabel")}
                      </button>
                    )}
                    {contextContentDefinition?.catalog.fields.length ? (
                      <button role="menuitem" onClick={openContentSettings}>
                        {t("workspace.action.editContent")}
                      </button>
                    ) : null}
                    {contextRequiredPermissions.length > 0 && (
                      <button role="menuitem" onClick={openPermissionManager}>
                        {t("workspace.permission.manageWithCount", {
                          granted: contextGrantedPermissions.length,
                          total: contextRequiredPermissions.length,
                        })}
                      </button>
                    )}
                    <button
                      role="menuitem"
                      aria-pressed={contextBox.hiddenWhenLocked}
                      onClick={() => {
                        send("box.visibility.set", {
                          boxId: contextBox.id,
                          hiddenWhenLocked: !contextBox.hiddenWhenLocked,
                        });
                        setContext(null);
                      }}
                    >
                      {t(contextBox.hiddenWhenLocked ? "workspace.action.showWhenLocked" : "workspace.action.hideWhenLocked")}
                    </button>
                    {contextBox.role.type === "content" && (
                      <>
                      <button
                        role="menuitem"
                        onClick={() => selectClipboard("cut", contextBox.id)}
                      >
                        {t("workspace.action.cutBox")}
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => selectClipboard("clone", contextBox.id)}
                      >
                        {t("workspace.action.cloneBox")}
                      </button>
                      </>
                    )}
                    {!isProtectedBox(contextBox) && (
                      <button
                        role="menuitem"
                        disabled={contextBoxHasChildren}
                        title={contextBoxHasChildren ? t("workspace.box.delete.hasChildren") : undefined}
                        onClick={() => setContext({ ...context, mode: "delete" })}
                      >
                        {t("workspace.action.deleteBox")}
                      </button>
                    )}
                    {contextBox.role.type === "device" && !workspace.layouts[contextBox.role.device]?.builtIn && (
                      <button
                        role="menuitem"
                        disabled={workspace.activeLayout === contextBox.role.device}
                        title={workspace.activeLayout === contextBox.role.device
                          ? t("workspace.layout.delete.active")
                          : undefined}
                        onClick={() => setContext({ ...context, mode: "delete-layout" })}
                      >
                        {t("workspace.action.deleteLayout")}
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {context.mode === "content-picker" && (
              selectedContentDefinition ? (
                <form onSubmit={addContentBox}>
                  <p>{t("workspace.content.configure", {
                    type: t(selectedContentDefinition.titleKey),
                  })}</p>
                  <label htmlFor="content-box-name">{t("workspace.content.boxName")}</label>
                  <input
                    id="content-box-name"
                    autoFocus
                    value={context.draftName}
                    onChange={(event) => setContext({
                      ...context,
                      draftName: event.target.value,
                      errorKey: null,
                    })}
                  />
                  {renderContentFields(selectedContentDefinition)}
                  {context.errorKey && <p className="context-error">{t(context.errorKey)}</p>}
                  <div className="context-actions">
                    <button type="submit">{t("workspace.content.create")}</button>
                    <button
                      type="button"
                      onClick={() => setContext({
                        ...context,
                        contentType: null,
                        draftName: "",
                        contentValues: {},
                        errorKey: null,
                      })}
                    >
                      {t("workspace.action.back")}
                    </button>
                  </div>
                </form>
              ) : (
                <div>
                  <p>{t("workspace.content.choose")}</p>
                  <div className="content-catalog-list">
                    {contentCatalog.map((definition) => (
                      <button
                        className="content-catalog-option"
                        key={definition.type}
                        onClick={() => selectContentType(definition)}
                      >
                        <strong>{t(definition.titleKey)}</strong>
                        <span>{t(definition.catalog.descriptionKey)}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setContext({ ...context, mode: "actions" })}>
                    {t("workspace.action.cancel")}
                  </button>
                </div>
              )
            )}

            {context.mode === "content-settings" && contextContent && contextContentDefinition && (
              <form onSubmit={saveContentSettings}>
                <p>{t("workspace.content.edit", { type: t(contextContentDefinition.titleKey) })}</p>
                {renderContentFields(contextContentDefinition)}
                {context.errorKey && <p className="context-error">{t(context.errorKey)}</p>}
                <div className="context-actions">
                  <button type="submit">{t("workspace.action.save")}</button>
                  <button type="button" onClick={() => setContext({ ...context, mode: "actions" })}>
                    {t("workspace.action.cancel")}
                  </button>
                </div>
              </form>
            )}

            {context.mode === "permissions" && contextBox && contextRequiredPermissions.length > 0 && (
              <div>
                <p>{t("workspace.permission.title", { name: contextBox.name })}</p>
                <div className="permission-list">
                  {contextRequiredPermissions.map((permission) => {
                    const definition = contextContentDefinition?.catalog.permissions
                      .find((candidate) => candidate.id === permission);
                    const granted = contextGrantedPermissions.includes(permission);
                    return (
                      <label className="permission-row" key={permission}>
                        <input
                          type="checkbox"
                          checked={granted}
                          onChange={() => setBoxPermissions(
                            contextBox.id,
                            granted
                              ? contextGrantedPermissions.filter((candidate) => candidate !== permission)
                              : [...contextGrantedPermissions, permission],
                          )}
                        />
                        <span>
                          <strong>{t(definition?.titleKey ?? "workspace.permission.unknown.title", { permission })}</strong>
                          <small>{t(
                            definition?.descriptionKey ?? "workspace.permission.unknown.description",
                            { permission },
                          )}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="context-stack permission-actions">
                  <button
                    disabled={contextGrantedPermissions.length === contextRequiredPermissions.length}
                    onClick={() => setBoxPermissions(contextBox.id, [...contextRequiredPermissions])}
                  >
                    {t("workspace.permission.grantAll")}
                  </button>
                  <button
                    disabled={contextGrantedPermissions.length === 0}
                    onClick={() => setBoxPermissions(contextBox.id, [])}
                  >
                    {t("workspace.permission.revokeAll")}
                  </button>
                  <button onClick={() => setContext({ ...context, mode: "actions" })}>
                    {t("workspace.action.back")}
                  </button>
                </div>
              </div>
            )}

            {context.mode === "rename" && contextBox && (
              <form onSubmit={renameBox}>
                <label htmlFor="box-name">{t("workspace.box.rename.label")}</label>
                <input
                  id="box-name"
                  autoFocus
                  value={context.draftName}
                  onChange={(event) => setContext({ ...context, draftName: event.target.value })}
                />
                <div className="context-actions">
                  <button type="submit">{t("workspace.action.save")}</button>
                  <button type="button" onClick={() => setContext({ ...context, mode: "actions" })}>{t("workspace.action.cancel")}</button>
                </div>
              </form>
            )}

            {context.mode === "label" && contextBox?.labelKey && (
              <form onSubmit={editBoxLabel}>
                <label htmlFor="box-label">{t("workspace.box.label.edit")}</label>
                <textarea
                  id="box-label"
                  autoFocus
                  rows={3}
                  value={context.draftLabel}
                  onChange={(event) => setContext({ ...context, draftLabel: event.target.value })}
                />
                <div className="context-actions">
                  <button type="submit">{t("workspace.action.save")}</button>
                  <button type="button" onClick={() => setContext({ ...context, mode: "actions" })}>{t("workspace.action.cancel")}</button>
                </div>
              </form>
            )}

            {context.mode === "add-layout" && (
              <form onSubmit={addLayout}>
                <p>{t("workspace.layout.create.title")}</p>
                <label htmlFor="layout-name">{t("workspace.layout.create.name")}</label>
                <input
                  id="layout-name"
                  autoFocus
                  value={context.draftName}
                  onChange={(event) => setContext({ ...context, draftName: event.target.value })}
                />
                <label htmlFor="layout-source">{t("workspace.layout.create.source")}</label>
                <select
                  id="layout-source"
                  value={context.sourceLayoutId}
                  onChange={(event) => setContext({ ...context, sourceLayoutId: event.target.value })}
                >
                  {workspace.layoutOrder.map((layoutId) => (
                    <option key={layoutId} value={layoutId}>{localizedLayoutLabel(workspace, layoutId)}</option>
                  ))}
                </select>
                <div className="context-actions">
                  <button type="submit">{t("workspace.action.createLayout")}</button>
                  <button type="button" onClick={() => setContext({ ...context, mode: "actions" })}>{t("workspace.action.cancel")}</button>
                </div>
              </form>
            )}

            {context.mode === "copy-layout" && (
              <div>
                <p>{t(contextBox ? "workspace.layout.copyBoxPrompt" : "workspace.layout.copyViewPrompt", {
                  layout: localizedLayoutLabel(workspace, workspace.activeLayout),
                })}</p>
                <div className="context-stack">
                  {workspace.layoutOrder
                    .filter((layoutId) => layoutId !== workspace.activeLayout)
                    .map((layoutId) => (
                      <button key={layoutId} onClick={() => copyLayout(layoutId)}>
                        {t("workspace.layout.copyTo", { layout: localizedLayoutLabel(workspace, layoutId) })}
                      </button>
                    ))}
                  <button onClick={() => setContext({ ...context, mode: "actions" })}>{t("workspace.action.cancel")}</button>
                </div>
              </div>
            )}

            {context.mode === "snapshots" && (
              <div>
                <p>{t("workspace.snapshot.title")}</p>
                {snapshots.length === 0 ? (
                  <p>{t("workspace.snapshot.empty")}</p>
                ) : (
                  <div className="snapshot-list">
                    {snapshots.map((snapshot) => (
                      <div className="snapshot-row" key={snapshot.id}>
                        <button
                          disabled={!workspace.preferences.handlesVisible}
                          onClick={() => restoreSnapshot(snapshot)}
                        >
                          <span>{snapshot.name}</span>
                          <small>{formatSnapshotDate(snapshot.createdAt)}</small>
                        </button>
                        <button className="danger" aria-label={t("workspace.snapshot.delete", { name: snapshot.name })} onClick={() => deleteSnapshot(snapshot.id)}>
                          {t("workspace.action.deleteSnapshot")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => setContext({ ...context, mode: "actions" })}>{t("workspace.action.back")}</button>
              </div>
            )}

            {context.mode === "import" && (
              <div>
                <label className="file-input-label">
                  {t("workspace.import.label")}
                  <input
                    className="visually-hidden"
                    type="file"
                    accept="application/json,.json"
                    onChange={importWorkspace}
                  />
                </label>
                {context.errorKey && <p className="context-error">{t(context.errorKey)}</p>}
                <button onClick={() => setContext({ ...context, mode: "actions" })}>{t("workspace.action.cancel")}</button>
              </div>
            )}

            {context.mode === "delete" && contextBox && !isProtectedBox(contextBox) && (
              <div>
                <p>{t("workspace.box.delete.confirm", { name: contextBox.name })}</p>
                <div className="context-actions">
                  <button
                    className="danger"
                    onClick={() => {
                      send("box.delete", { boxId: contextBox.id });
                      setContext(null);
                    }}
                  >
                    {t("workspace.action.deleteBox")}
                  </button>
                  <button onClick={() => setContext({ ...context, mode: "actions" })}>{t("workspace.action.cancel")}</button>
                </div>
              </div>
            )}

            {context.mode === "delete-layout"
              && contextBox?.role.type === "device"
              && !workspace.layouts[contextBox.role.device]?.builtIn && (
              <div>
                <p>{t("workspace.layout.delete.confirm", {
                  name: localizedLayoutLabel(workspace, contextBox.role.device),
                })}</p>
                <div className="context-actions">
                  <button
                    className="danger"
                    onClick={() => {
                      if (contextBox.role.type !== "device") return;
                      send("layout.delete", { layoutId: contextBox.role.device });
                      setContext(null);
                    }}
                  >
                    {t("workspace.action.deleteLayout")}
                  </button>
                  <button onClick={() => setContext({ ...context, mode: "actions" })}>{t("workspace.action.cancel")}</button>
                </div>
              </div>
            )}
          </aside>
        </>
      )}
    </main>
  );
}

function createInitialWorkspace(
  application: Readonly<SynAIusApplicationManifest>,
  t: ReturnType<typeof createTranslator>,
  deviceNames: DeviceNames,
  cloneNameTemplates: CloneNameTemplates,
  initializeWorkspace?: (workspace: WorkspaceState) => WorkspaceState,
) {
  const detectedLayout = deviceKindForWidth(window.innerWidth);
  const fallback = createWorkspace({
    workspaceId: application.initialWorkspace.workspaceId,
    initialViewId: application.initialWorkspace.viewId,
    initialViewName: t(application.initialWorkspace.viewTitleKey),
    deviceNames,
    cloneNameTemplates,
    initialLayout: detectedLayout,
  });
  let workspace = loadWorkspace(
    fallback,
    deviceNames,
    detectedLayout,
    cloneNameTemplates,
    application.storageNamespace,
  );
  workspace = initializeWorkspace?.(workspace) ?? workspace;
  const selectedLayout = workspace.layouts[workspace.activeLayout]?.builtIn
    ? detectedLayout
    : workspace.activeLayout;
  if (workspace.activeLayout !== selectedLayout) {
    workspace = applyWorkspaceCommand(workspace, {
      id: crypto.randomUUID(),
      expectedRevision: workspace.revision,
      type: "layout.activate",
      payload: { layoutId: selectedLayout },
    }).state;
  }
  const defaultViewId = workspace.deviceDefaults[selectedLayout];
  if (!defaultViewId || !workspace.views[defaultViewId] || defaultViewId === workspace.activeViewId) return workspace;
  return applyWorkspaceCommand(workspace, {
    id: crypto.randomUUID(),
    expectedRevision: workspace.revision,
    type: "view.activate",
    payload: { viewId: defaultViewId },
  }).state;
}

function deviceKindForWidth(width: number): BuiltInDeviceKind {
  if (width <= 640) return "mobile";
  if (width <= 1024) return "tablet";
  return "desktop";
}

function nextAvailableName(
  t: ReturnType<typeof createTranslator>,
  key: string,
  occupiedNames: string[],
) {
  const canonicalNames = new Set(occupiedNames.map((name) => name.toLocaleLowerCase("hu-HU")));
  let count = 1;
  while (canonicalNames.has(t(key, { count }).toLocaleLowerCase("hu-HU"))) count += 1;
  return t(key, { count });
}

function nextAvailableLiteralName(
  t: ReturnType<typeof createTranslator>,
  defaultName: string,
  occupiedNames: string[],
) {
  const canonicalNames = new Set(occupiedNames.map((name) => name.toLocaleLowerCase("hu-HU")));
  if (!canonicalNames.has(defaultName.toLocaleLowerCase("hu-HU"))) return defaultName;
  let count = 2;
  let candidate = t("workspace.content.boxNameNumbered", { name: defaultName, count });
  while (canonicalNames.has(candidate.toLocaleLowerCase("hu-HU"))) {
    count += 1;
    candidate = t("workspace.content.boxNameNumbered", { name: defaultName, count });
  }
  return candidate;
}

function resolveCatalogDefinition(
  registry: ContentRegistry<ReactNode, WorkspaceContentRenderContext>,
  type: string,
  version: number,
) {
  try {
    const definition = registry.resolve(type, version);
    return definition.catalog
      ? definition as CatalogContentRendererDefinition<ReactNode, WorkspaceContentRenderContext>
      : null;
  } catch {
    return null;
  }
}

function contentFieldValues(
  definition: CatalogContentRendererDefinition<ReactNode, WorkspaceContentRenderContext>,
  configuration: JsonObject,
) {
  return Object.fromEntries(definition.catalog.fields.map((field) => [
    field.key,
    typeof configuration[field.key] === "string" ? configuration[field.key] : "",
  ])) as Record<string, string>;
}

function requiredPermissionsFor(
  definition: CatalogContentRendererDefinition<ReactNode, WorkspaceContentRenderContext> | null,
  content: ContentInstance | null,
) {
  return definition?.catalog.requiredPermissions ?? content?.requiredPermissions ?? [];
}

function menuPosition(clientX: number, clientY: number) {
  return {
    x: Math.max(8, Math.min(clientX, window.innerWidth - 264)),
    y: Math.max(8, Math.min(clientY, window.innerHeight - 420)),
  };
}

function findGridElement(parentId: string | null) {
  if (parentId === null) return document.querySelector<HTMLElement>(".canvas");
  return Array.from(document.querySelectorAll<HTMLElement>("[data-child-grid]"))
    .find((element) => element.dataset.childGrid === parentId) ?? null;
}

function pointIsInside(element: HTMLElement, clientX: number, clientY: number) {
  const bounds = element.getBoundingClientRect();
  return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
}

function descendantIds(workspace: WorkspaceState, boxId: string): string[] {
  const direct = Object.values(workspace.boxes).filter((box) => box.parentId === boxId);
  return direct.flatMap((box) => [box.id, ...descendantIds(workspace, box.id)]);
}

function localizedBoxLabel(workspace: WorkspaceState, box: BoxNode) {
  return box.labelKey ? workspace.localeMessages[box.labelKey] ?? "" : "";
}

function localizedLayoutLabel(workspace: WorkspaceState, layoutId: LayoutId) {
  const layout = workspace.layouts[layoutId];
  return layout ? workspace.localeMessages[layout.labelKey] ?? layout.name : layoutId;
}

function boxIsHiddenWhenLocked(workspace: WorkspaceState, box: BoxNode) {
  let current: BoxNode | undefined = box;
  while (current) {
    if (current.hiddenWhenLocked) return true;
    current = current.parentId ? workspace.boxes[current.parentId] : undefined;
  }
  return false;
}

function sameRect(left: GridRect, right: GridRect) {
  return left.column === right.column
    && left.row === right.row
    && left.width === right.width
    && left.height === right.height;
}

function commandRecordsHistory(type: WorkspaceCommand["type"]) {
  return !([
    "view.activate",
    "layout.activate",
    "grid.visibility.set",
    "workspace.handles.set",
    "workspace.names.set",
  ] as WorkspaceCommand["type"][]).includes(type);
}

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function formatSnapshotDate(value: string) {
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
