import { useMemo, useState } from "react";
import {
  applyWorkspaceCommand,
  createWorkspace,
  type BoxNode,
  type CommandPayload,
  type DeviceKind,
  type WorkspaceCommand,
} from "@synaius/domain";
import { createTranslator } from "@synaius/i18n";
import hu from "../../../locales/hu.json";

const t = createTranslator(hu);

function nextName(key: string, count: number) {
  return t(key, { count });
}

export function App() {
  const [workspace, setWorkspace] = useState(() =>
    createWorkspace({
      workspaceId: "workspace-main",
      initialViewId: "view-main",
      initialViewName: t("view.defaultName"),
    }),
  );

  document.title = t("app.title");

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

  function addView() {
    const count = Object.keys(workspace.views).length + 1;
    const viewId = crypto.randomUUID();
    send("view.create", { viewId, name: nextName("view.generatedName", count) });
    send("view.activate", { viewId });
  }

  function addBox() {
    const count = Object.keys(workspace.boxes).length + 1;
    send("box.create", {
      boxId: crypto.randomUUID(),
      viewId: activeView.id,
      parentId: null,
      name: nextName("box.generatedName", count),
      rect: { column: (count - 1) % 6, row: Math.floor((count - 1) / 6) * 3, width: 3, height: 3 },
    });
  }

  function setDeviceDefault(device: DeviceKind) {
    send("view.setDeviceDefault", { device, viewId: activeView.id });
  }

  function renderBox(box: BoxNode) {
    const children = activeBoxes.filter((candidate) => candidate.parentId === box.id);
    return (
      <article
        className="canvas-box"
        data-box-id={box.id}
        key={box.id}
        style={{
          gridColumn: `${box.rect.column + 1} / span ${box.rect.width}`,
          gridRow: `${box.rect.row + 1} / span ${box.rect.height}`,
          ...box.style.declarations,
        }}
      >
        <button className="handle handle-start" aria-label={t("box.handle.start")} />
        <button className="handle handle-move" aria-label={t("box.handle.move")} />
        <strong>{box.name}</strong>
        <div className="box-children">{children.map(renderBox)}</div>
        <button className="handle handle-end" aria-label={t("box.handle.end")} />
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
          <button onClick={addBox}>{t("action.addBox")}</button>
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

      <section
        className="canvas"
        data-grid-visible={activeView.grid.visible}
        style={{ "--grid-columns": activeView.grid.columns } as React.CSSProperties}
        aria-label={t("canvas.label")}
      >
        {activeBoxes.filter((box) => box.parentId === null).map(renderBox)}
        {activeBoxes.length === 0 && <p className="empty-state">{t("canvas.empty")}</p>}
      </section>
    </main>
  );
}
