import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  applyWorkspaceCommand,
  createWorkspace,
  isProtectedBox,
  type BoxNode,
  type CommandPayload,
  type DeviceKind,
  type DeviceNames,
  type GridRect,
  type WorkspaceCommand,
  type WorkspaceState,
} from "@synaius/domain";
import { createTranslator } from "@synaius/i18n";
import hu from "../../../locales/hu.json";
import {
  gridDeltaFromClient,
  gridPointFromClient,
  moveRect,
  readGridMetrics,
  rectAtPoint,
  resizeRectFromEnd,
  resizeRectFromStart,
  type GridMetrics,
  type GridPoint,
} from "./grid-interaction";
import { loadWorkspace, saveWorkspace } from "./workspace-storage";

const t = createTranslator(hu);
const deviceNames: DeviceNames = {
  desktop: t("device.desktop"),
  tablet: t("device.tablet"),
  mobile: t("device.mobile"),
};

type DragMode = "move" | "resize-start" | "resize-end";
type ContextMode = "actions" | "rename" | "delete";
type Surface = "main" | "background";

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

interface ContextState {
  boxId: string | null;
  point: GridPoint;
  x: number;
  y: number;
  mode: ContextMode;
  draftName: string;
}

type GridStyle = CSSProperties & { "--grid-columns": number };

export function App() {
  const [workspace, setWorkspace] = useState(createInitialWorkspace);
  const [surface, setSurface] = useState<Surface>("main");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [context, setContext] = useState<ContextState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  document.title = t("app.title");

  useEffect(() => {
    saveWorkspace(workspace);
  }, [workspace]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
      event.preventDefault();
      updateDragAt(event.clientX, event.clientY);
    }

    function onPointerUp(event: PointerEvent) {
      if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
      finishDragAt(event.clientX, event.clientY);
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
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("mousemove", onMouseMove, { passive: false });
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function send<T extends WorkspaceCommand["type"]>(type: T, payload: CommandPayload<T>) {
    setWorkspace((current) =>
      applyWorkspaceCommand(current, {
        id: crypto.randomUUID(),
        expectedRevision: current.revision,
        type,
        payload,
      } as WorkspaceCommand).state,
    );
  }

  const activeView = workspace.views[workspace.activeViewId];
  const surfaceArchived = surface === "background";
  const surfaceBoxes = useMemo(
    () => Object.values(workspace.boxes).filter((box) =>
      (box.viewId === null || box.viewId === activeView.id) && box.archived === surfaceArchived),
    [activeView.id, surfaceArchived, workspace.boxes],
  );
  const surfaceBoxIds = useMemo(() => new Set(surfaceBoxes.map((box) => box.id)), [surfaceBoxes]);
  const visibleRootBoxes = useMemo(
    () => surfaceBoxes.filter((box) => box.parentId === null || !surfaceBoxIds.has(box.parentId)),
    [surfaceBoxes, surfaceBoxIds],
  );
  const contextBox = context?.boxId ? workspace.boxes[context.boxId] : null;
  const contextBoxHasChildren = contextBox
    ? Object.values(workspace.boxes).some((box) => box.parentId === contextBox.id)
    : false;

  function addView() {
    setWorkspace((current) => {
      const viewId = crypto.randomUUID();
      const name = nextAvailableName("view.generatedName", Object.values(current.views).map((view) => view.name));
      const created = applyWorkspaceCommand(current, {
        id: crypto.randomUUID(),
        expectedRevision: current.revision,
        type: "view.create",
        payload: { viewId, name },
      });
      return applyWorkspaceCommand(created.state, {
        id: crypto.randomUUID(),
        expectedRevision: created.state.revision,
        type: "view.activate",
        payload: { viewId },
      }).state;
    });
    setContext(null);
  }

  function addBox(parentId: string | null = null, point?: GridPoint) {
    setWorkspace((current) => {
      const view = current.views[current.activeViewId];
      const parent = parentId ? current.boxes[parentId] : null;
      const columns = parent?.childGrid.columns ?? view.grid.columns;
      const occupiedNames = Object.values(current.boxes).map((box) => box.name);
      const contentCount = Object.values(current.boxes).filter((box) => box.role.type === "content").length;
      const fallbackPoint = {
        column: contentCount % Math.max(1, columns - 5),
        row: 3 + Math.floor(contentCount / 4) * 4,
      };
      return applyWorkspaceCommand(current, {
        id: crypto.randomUUID(),
        expectedRevision: current.revision,
        type: "box.create",
        payload: {
          boxId: crypto.randomUUID(),
          viewId: view.id,
          parentId,
          name: nextAvailableName("box.generatedName", occupiedNames),
          rect: rectAtPoint(point ?? fallbackPoint, 6, 4, columns),
        },
      }).state;
    });
    setContext(null);
  }

  function openCanvasContext(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    if (!canvasRef.current) return;
    const metrics = readGridMetrics(canvasRef.current, activeView.grid.columns);
    setContext({
      boxId: null,
      point: gridPointFromClient(metrics, event.clientX, event.clientY),
      ...menuPosition(event.clientX, event.clientY),
      mode: "actions",
      draftName: "",
    });
  }

  function openBoxContext(event: ReactMouseEvent<HTMLElement>, box: BoxNode) {
    event.preventDefault();
    event.stopPropagation();
    setContext({
      boxId: box.id,
      point: { column: 0, row: 0 },
      ...menuPosition(event.clientX, event.clientY),
      mode: "actions",
      draftName: box.name,
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

  function switchSurface(nextSurface: Surface) {
    setSurface(nextSurface);
    setContext(null);
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, box: BoxNode, mode: DragMode) {
    if (event.button !== 0) return;
    const grid = findGridElement(box.parentId);
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
      metrics: readGridMetrics(grid, parent?.childGrid.columns ?? activeView.grid.columns),
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

    const currentView = currentWorkspace.views[currentWorkspace.activeViewId];
    if (!targetParentId && box.parentId !== null && canvasRef.current && pointIsInside(canvasRef.current, clientX, clientY)) {
      const metrics = readGridMetrics(canvasRef.current, currentView.grid.columns);
      send("box.nest", {
        boxId: box.id,
        parentId: null,
        layout,
        rect: rectAtPoint(
          gridPointFromClient(metrics, clientX, clientY),
          boxRect.width,
          boxRect.height,
          currentView.grid.columns,
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
        && target.viewId === box.viewId
        && target.archived === box.archived) return target.id;
    }
    return null;
  }

  function activateSystemBox(box: BoxNode) {
    if (box.role.type === "view") send("view.activate", { viewId: box.role.viewId });
    if (box.role.type === "device") send("layout.activate", { device: box.role.device });
  }

  function systemBoxSelected(box: BoxNode) {
    if (box.role.type === "view") return box.role.viewId === activeView.id;
    if (box.role.type === "device") return workspace.activeLayout === box.role.device;
    return false;
  }

  function renderBox(box: BoxNode) {
    const children = surfaceBoxes.filter((candidate) => candidate.parentId === box.id);
    const renderedRect = drag?.boxId === box.id ? drag.previewRect : box.layoutRects[workspace.activeLayout];
    return (
      <article
        className="canvas-box"
        data-box-id={box.id}
        data-box-role={box.role.type}
        data-dragging={drag?.boxId === box.id}
        key={box.id}
        onContextMenu={(event) => openBoxContext(event, box)}
        style={{
          gridColumn: `${renderedRect.column + 1} / span ${renderedRect.width}`,
          gridRow: `${renderedRect.row + 1} / span ${renderedRect.height}`,
          ...box.style.declarations,
        }}
      >
        <button
          className="handle handle-start"
          aria-label={t("box.handle.start")}
          onPointerDown={(event) => beginDrag(event, box, "resize-start")}
        />
        <button
          className="handle handle-move"
          aria-label={t("box.handle.move")}
          onPointerDown={(event) => beginDrag(event, box, "move")}
        />
        <strong className="box-name">{box.name}</strong>
        {box.role.type !== "content" && (
          <button
            className="system-box-action"
            aria-label={box.name}
            aria-pressed={systemBoxSelected(box)}
            onClick={() => activateSystemBox(box)}
          >
            <span aria-hidden="true">{systemBoxSelected(box) ? "●" : "○"}</span>
          </button>
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
          aria-label={t("box.handle.end")}
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
      data-surface={surface}
      data-layout={workspace.activeLayout}
    >
      <section
        className="canvas"
        data-grid-visible={activeView.grid.visible}
        style={{ "--grid-columns": activeView.grid.columns } as GridStyle}
        aria-label={t(surface === "main" ? "canvas.label" : "surface.backgroundLabel")}
        onContextMenu={openCanvasContext}
        ref={canvasRef}
      >
        {visibleRootBoxes.map(renderBox)}
      </section>

      {surface === "background" && <div className="surface-badge">{t("surface.background")}</div>}

      {context && (
        <>
          <div className="context-backdrop" aria-hidden="true" onPointerDown={() => setContext(null)} />
          <aside
            className="context-menu"
            role="menu"
            style={{ left: context.x, top: context.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {context.mode === "actions" && (
              <>
                {surface === "main" && (
                  <button
                    role="menuitem"
                    onClick={() => addBox(
                      contextBox?.role.type === "content" ? contextBox.id : null,
                      contextBox?.role.type === "content" ? { column: 0, row: 0 } : context.point,
                    )}
                  >
                    {t(contextBox?.role.type === "content" ? "context.addInside" : "action.addBox")}
                  </button>
                )}
                <button role="menuitem" onClick={addView}>{t("action.addView")}</button>
                <button
                  role="menuitem"
                  onClick={() => {
                    send("grid.visibility.set", { viewId: activeView.id, visible: !activeView.grid.visible });
                    setContext(null);
                  }}
                >
                  {t(activeView.grid.visible ? "action.hideGrid" : "action.showGrid")}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    send("workspace.handles.set", { visible: !workspace.preferences.handlesVisible });
                    setContext(null);
                  }}
                >
                  {t(workspace.preferences.handlesVisible ? "action.hideHandles" : "action.showHandles")}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    send("workspace.names.set", { visible: !workspace.preferences.namesVisible });
                    setContext(null);
                  }}
                >
                  {t(workspace.preferences.namesVisible ? "action.hideNames" : "action.showNames")}
                </button>
                <button
                  className="surface-menu-item"
                  role="menuitem"
                  onClick={() => switchSurface(surface === "main" ? "background" : "main")}
                >
                  {t(surface === "main" ? "action.openBackground" : "action.openMain")}
                </button>

                {contextBox && (
                  <>
                    {contextBox.role.type === "view" && (
                      <button
                        role="menuitem"
                        aria-pressed={workspace.deviceDefaults[workspace.activeLayout] === contextBox.role.viewId}
                        onClick={() => {
                          if (contextBox.role.type !== "view") return;
                          send("view.setDeviceDefault", {
                            device: workspace.activeLayout,
                            viewId: contextBox.role.viewId,
                          });
                          setContext(null);
                        }}
                      >
                        {t("action.setDefaultView", { layout: deviceNames[workspace.activeLayout] })}
                      </button>
                    )}
                    <button role="menuitem" onClick={() => setContext({ ...context, mode: "rename" })}>
                      {t("action.renameBox")}
                    </button>
                    {surface === "main" ? (
                      <button
                        role="menuitem"
                        onClick={() => {
                          send("box.archive", { boxId: contextBox.id });
                          setContext(null);
                        }}
                      >
                        {t("action.archiveBox")}
                      </button>
                    ) : (
                      <button
                        role="menuitem"
                        onClick={() => {
                          send("box.restore", {
                            boxId: contextBox.id,
                            parentId: null,
                            layout: workspace.activeLayout,
                            rect: contextBox.layoutRects[workspace.activeLayout],
                          });
                          setContext(null);
                        }}
                      >
                        {t("action.restoreBox")}
                      </button>
                    )}
                    {!isProtectedBox(contextBox) && (
                      <button
                        role="menuitem"
                        disabled={contextBoxHasChildren}
                        title={contextBoxHasChildren ? t("box.delete.hasChildren") : undefined}
                        onClick={() => setContext({ ...context, mode: "delete" })}
                      >
                        {t("action.deleteBox")}
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {context.mode === "rename" && contextBox && (
              <form onSubmit={renameBox}>
                <label htmlFor="box-name">{t("box.rename.label")}</label>
                <input
                  id="box-name"
                  autoFocus
                  value={context.draftName}
                  onChange={(event) => setContext({ ...context, draftName: event.target.value })}
                />
                <div className="context-actions">
                  <button type="submit">{t("action.save")}</button>
                  <button type="button" onClick={() => setContext({ ...context, mode: "actions" })}>{t("action.cancel")}</button>
                </div>
              </form>
            )}

            {context.mode === "delete" && contextBox && !isProtectedBox(contextBox) && (
              <div>
                <p>{t("box.delete.confirm", { name: contextBox.name })}</p>
                <div className="context-actions">
                  <button
                    className="danger"
                    onClick={() => {
                      send("box.delete", { boxId: contextBox.id });
                      setContext(null);
                    }}
                  >
                    {t("action.deleteBox")}
                  </button>
                  <button onClick={() => setContext({ ...context, mode: "actions" })}>{t("action.cancel")}</button>
                </div>
              </div>
            )}
          </aside>
        </>
      )}
    </main>
  );
}

function createInitialWorkspace() {
  const detectedLayout = deviceKindForWidth(window.innerWidth);
  const fallback = createWorkspace({
    workspaceId: "workspace-main",
    initialViewId: "view-main",
    initialViewName: t("view.defaultName"),
    deviceNames,
    initialLayout: detectedLayout,
  });
  let workspace = loadWorkspace(fallback, deviceNames, detectedLayout);
  if (workspace.activeLayout !== detectedLayout) {
    workspace = applyWorkspaceCommand(workspace, {
      id: crypto.randomUUID(),
      expectedRevision: workspace.revision,
      type: "layout.activate",
      payload: { device: detectedLayout },
    }).state;
  }
  const defaultViewId = workspace.deviceDefaults[detectedLayout];
  if (!defaultViewId || !workspace.views[defaultViewId] || defaultViewId === workspace.activeViewId) return workspace;
  return applyWorkspaceCommand(workspace, {
    id: crypto.randomUUID(),
    expectedRevision: workspace.revision,
    type: "view.activate",
    payload: { viewId: defaultViewId },
  }).state;
}

function deviceKindForWidth(width: number): DeviceKind {
  if (width <= 640) return "mobile";
  if (width <= 1024) return "tablet";
  return "desktop";
}

function nextAvailableName(key: string, occupiedNames: string[]) {
  const canonicalNames = new Set(occupiedNames.map((name) => name.toLocaleLowerCase("hu-HU")));
  let count = 1;
  while (canonicalNames.has(t(key, { count }).toLocaleLowerCase("hu-HU"))) count += 1;
  return t(key, { count });
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
