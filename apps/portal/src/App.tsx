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
  type BoxNode,
  type CommandPayload,
  type DeviceKind,
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

type DragMode = "move" | "resize-start" | "resize-end";
type ContextMode = "actions" | "rename" | "delete";

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
  const activeBoxes = useMemo(
    () => Object.values(workspace.boxes).filter((box) => box.viewId === activeView.id && !box.archived),
    [activeView.id, workspace.boxes],
  );
  const visibleRootBoxes = useMemo(
    () => activeBoxes.filter((box) => box.parentId === null),
    [activeBoxes],
  );
  const archivedBoxes = useMemo(
    () => Object.values(workspace.boxes).filter((box) => box.viewId === activeView.id && box.archived),
    [activeView.id, workspace.boxes],
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
  }

  function addBox(parentId: string | null = null, point?: GridPoint) {
    setWorkspace((current) => {
      const view = current.views[current.activeViewId];
      const parent = parentId ? current.boxes[parentId] : null;
      const columns = parent?.childGrid.columns ?? view.grid.columns;
      const occupiedNames = Object.values(current.boxes).map((box) => box.name);
      const fallbackPoint = {
        column: Object.keys(current.boxes).length % Math.max(1, columns - 2),
        row: Math.floor(Object.keys(current.boxes).length / 4) * 3,
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
          rect: rectAtPoint(point ?? fallbackPoint, 3, 3, columns),
        },
      }).state;
    });
    setContext(null);
  }

  function setDeviceDefault(device: DeviceKind) {
    send("view.setDeviceDefault", { device, viewId: activeView.id });
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

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, box: BoxNode, mode: DragMode) {
    if (event.button !== 0) return;
    const grid = findGridElement(box.parentId);
    if (!grid) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const parent = box.parentId ? workspace.boxes[box.parentId] : null;
    const nextDrag: DragState = {
      boxId: box.id,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: box.rect,
      previewRect: box.rect,
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
    if (current.mode !== "move") {
      send("box.resize", { boxId: box.id, rect: current.previewRect });
      return;
    }

    const targetParentId = findDropParentId(currentWorkspace, box.id, clientX, clientY);
    if (targetParentId && targetParentId !== box.parentId) {
      const targetParent = currentWorkspace.boxes[targetParentId];
      const targetGrid = findGridElement(targetParentId);
      if (targetParent && targetGrid) {
        const metrics = readGridMetrics(targetGrid, targetParent.childGrid.columns);
        send("box.nest", {
          boxId: box.id,
          parentId: targetParentId,
          rect: rectAtPoint(
            gridPointFromClient(metrics, clientX, clientY),
            box.rect.width,
            box.rect.height,
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
        rect: rectAtPoint(
          gridPointFromClient(metrics, clientX, clientY),
          box.rect.width,
          box.rect.height,
          currentView.grid.columns,
        ),
      });
      return;
    }

    send("box.move", {
      boxId: box.id,
      column: current.previewRect.column,
      row: current.previewRect.row,
    });
  }

  function cancelDrag() {
    dragRef.current = null;
    setDrag(null);
  }

  function findDropParentId(currentWorkspace: WorkspaceState, boxId: string, clientX: number, clientY: number) {
    const forbidden = new Set([boxId, ...descendantIds(currentWorkspace, boxId)]);
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const candidate = element.closest<HTMLElement>("[data-box-id]");
      const candidateId = candidate?.dataset.boxId;
      if (candidateId && !forbidden.has(candidateId) && currentWorkspace.boxes[candidateId] && !currentWorkspace.boxes[candidateId].archived) {
        return candidateId;
      }
    }
    return null;
  }

  function renderBox(box: BoxNode) {
    const children = activeBoxes.filter((candidate) => candidate.parentId === box.id);
    const renderedRect = drag?.boxId === box.id ? drag.previewRect : box.rect;
    return (
      <article
        className="canvas-box"
        data-box-id={box.id}
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
    <main className="portal-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{t("app.stage")}</p>
          <h1>{t("app.title")}</h1>
        </div>
        <div className="toolbar">
          <button onClick={addView}>{t("action.addView")}</button>
          <button onClick={() => addBox()}>{t("action.addBox")}</button>
          <button
            aria-pressed={activeView.grid.visible}
            onClick={() => send("grid.visibility.set", { viewId: activeView.id, visible: !activeView.grid.visible })}
          >
            {t(activeView.grid.visible ? "action.hideGrid" : "action.showGrid")}
          </button>
        </div>
      </header>

      <nav className="viewbar" aria-label={t("view.navigationLabel")}>
        {Object.values(workspace.views).map((view) => (
          <button
            aria-current={view.id === activeView.id ? "page" : undefined}
            key={view.id}
            onClick={() => send("view.activate", { viewId: view.id })}
          >
            {view.name}
          </button>
        ))}
      </nav>

      <section className="device-defaults" aria-label={t("device.defaultsLabel")}>
        {(["desktop", "tablet", "mobile"] as const).map((device) => (
          <button key={device} onClick={() => setDeviceDefault(device)}>
            {t(`device.${device}`)}
            <span aria-hidden="true">{workspace.deviceDefaults[device] === activeView.id ? "●" : "○"}</span>
          </button>
        ))}
      </section>

      <div className="workspace-layout">
        <section
          className="canvas"
          data-grid-visible={activeView.grid.visible}
          style={{ "--grid-columns": activeView.grid.columns } as GridStyle}
          aria-label={t("canvas.label")}
          onContextMenu={openCanvasContext}
          ref={canvasRef}
        >
          {visibleRootBoxes.map(renderBox)}
          {visibleRootBoxes.length === 0 && <p className="empty-state">{t("canvas.empty")}</p>}
        </section>

        <aside className="archive-panel" aria-label={t("archive.label")}>
          <div className="archive-heading">
            <h2>{t("archive.title")}</h2>
            <span>{t("archive.count", { count: archivedBoxes.length })}</span>
          </div>
          {archivedBoxes.length === 0 ? (
            <p>{t("archive.empty")}</p>
          ) : (
            <ul>
              {archivedBoxes.map((box) => (
                <li key={box.id}>
                  <span>{box.name}</span>
                  <button onClick={() => send("box.restore", { boxId: box.id, parentId: null, rect: box.rect })}>
                    {t("action.restoreBox")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

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
                <button role="menuitem" onClick={() => addBox(context.boxId, context.boxId ? { column: 0, row: 0 } : context.point)}>
                  {t(context.boxId ? "context.addInside" : "action.addBox")}
                </button>
                {contextBox && (
                  <>
                    <button role="menuitem" onClick={() => setContext({ ...context, mode: "rename" })}>
                      {t("action.renameBox")}
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        send("box.archive", { boxId: contextBox.id });
                        setContext(null);
                      }}
                    >
                      {t("action.archiveBox")}
                    </button>
                    <button
                      role="menuitem"
                      disabled={contextBoxHasChildren}
                      title={contextBoxHasChildren ? t("box.delete.hasChildren") : undefined}
                      onClick={() => setContext({ ...context, mode: "delete" })}
                    >
                      {t("action.deleteBox")}
                    </button>
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

            {context.mode === "delete" && contextBox && (
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
  const fallback = createWorkspace({
    workspaceId: "workspace-main",
    initialViewId: "view-main",
    initialViewName: t("view.defaultName"),
  });
  const workspace = loadWorkspace(fallback);
  const defaultViewId = workspace.deviceDefaults[deviceKindForWidth(window.innerWidth)];
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
    x: Math.max(8, Math.min(clientX, window.innerWidth - 248)),
    y: Math.max(8, Math.min(clientY, window.innerHeight - 248)),
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
