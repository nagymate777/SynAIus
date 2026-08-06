import { describe, expect, it } from "vitest";
import { applyWorkspaceCommand, createWorkspace, DomainError, type WorkspaceCommand, type WorkspaceState } from "@synaius/domain";

function initial() {
  return createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
}

function apply(state: WorkspaceState, command: Omit<WorkspaceCommand, "id" | "expectedRevision">) {
  return applyWorkspaceCommand(state, {
    ...command,
    id: `command-${state.revision + 1}`,
    expectedRevision: state.revision,
  } as WorkspaceCommand).state;
}

function withTwoBoxes() {
  let state = initial();
  state = apply(state, { type: "box.create", payload: { boxId: "parent", viewId: "main", parentId: null, name: "Szülő", rect: { column: 0, row: 0, width: 6, height: 6 } } });
  state = apply(state, { type: "box.create", payload: { boxId: "child", viewId: "main", parentId: null, name: "Gyermek", rect: { column: 6, row: 0, width: 3, height: 3 } } });
  return state;
}

describe("workspace command core", () => {
  it("creates protected global view and device control boxes on the dense grid", () => {
    const state = initial();
    const systemBoxes = Object.values(state.boxes).filter((box) => box.role.type !== "content");
    expect(state.schemaVersion).toBe(3);
    expect(state.activeLayout).toBe("desktop");
    expect(state.deviceDefaults).toEqual({ desktop: "main", tablet: "main", mobile: "main" });
    expect(state.views.main.grid.columns).toBe(24);
    expect(systemBoxes).toHaveLength(4);
    expect(systemBoxes.every((box) => box.viewId === null)).toBe(true);
    expect(() => apply(state, {
      type: "box.delete",
      payload: { boxId: systemBoxes[0].id },
    })).toThrowError(new DomainError("box.delete.protected"));
  });

  it("uses optimistic revisions and immutable state", () => {
    const before = initial();
    const result = applyWorkspaceCommand(before, {
      id: "command-1",
      expectedRevision: 0,
      type: "grid.visibility.set",
      payload: { viewId: "main", visible: true },
    });
    expect(before.views.main.grid.visible).toBe(false);
    expect(result.state.views.main.grid.visible).toBe(true);
    expect(result.state.revision).toBe(1);
    expect(result.event.revision).toBe(1);
  });

  it("rejects commands built on a stale revision", () => {
    expect(() => applyWorkspaceCommand(initial(), {
      id: "stale",
      expectedRevision: 3,
      type: "view.activate",
      payload: { viewId: "main" },
    })).toThrowError(new DomainError("workspace.revision.conflict"));
  });

  it("keeps box names unique across the workspace", () => {
    const state = apply(initial(), {
      type: "box.create",
      payload: { boxId: "one", viewId: "main", parentId: null, name: "Műszerfal", rect: { column: 0, row: 0, width: 3, height: 3 } },
    });
    expect(() => apply(state, {
      type: "box.create",
      payload: { boxId: "two", viewId: "main", parentId: null, name: "műszerfal", rect: { column: 3, row: 0, width: 3, height: 3 } },
    })).toThrowError(new DomainError("box.name.duplicate"));
  });

  it("nests boxes without changing child coordinates when the parent later moves", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.nest", payload: { boxId: "child", parentId: "parent", layout: "desktop", rect: { column: 2, row: 1, width: 4, height: 3 } } });
    state = apply(state, { type: "box.move", payload: { boxId: "parent", layout: "desktop", column: 3, row: 4 } });
    expect(state.boxes.child.parentId).toBe("parent");
    expect(state.boxes.child.layoutRects.desktop).toEqual({ column: 2, row: 1, width: 4, height: 3 });
  });

  it("prevents parent cycles", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.nest", payload: { boxId: "child", parentId: "parent", layout: "desktop", rect: { column: 0, row: 0, width: 3, height: 3 } } });
    expect(() => apply(state, {
      type: "box.nest",
      payload: { boxId: "parent", parentId: "child", layout: "desktop", rect: { column: 0, row: 0, width: 3, height: 3 } },
    })).toThrowError(new DomainError("box.parent.cycle"));
  });

  it("archives and restores a box without deleting its identity or style", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.style.patch", payload: { boxId: "child", declarations: { color: "#fff" } } });
    state = apply(state, { type: "box.archive", payload: { boxId: "child" } });
    expect(state.boxes.child.archived).toBe(true);
    state = apply(state, { type: "box.restore", payload: { boxId: "child", parentId: null, layout: "desktop", rect: { column: 6, row: 0, width: 3, height: 3 } } });
    expect(state.boxes.child.archived).toBe(false);
    expect(state.boxes.child.style.declarations.color).toBe("#fff");
  });

  it("moves an entire nested subtree between the main and background surfaces", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.nest", payload: { boxId: "child", parentId: "parent", layout: "desktop", rect: { column: 2, row: 1, width: 4, height: 3 } } });
    state = apply(state, { type: "box.archive", payload: { boxId: "parent" } });
    expect(state.boxes.parent.archived).toBe(true);
    expect(state.boxes.child.archived).toBe(true);
    state = apply(state, { type: "box.move", payload: { boxId: "parent", layout: "desktop", column: 4, row: 5 } });
    state = apply(state, { type: "box.restore", payload: { boxId: "parent", parentId: null, layout: "desktop", rect: state.boxes.parent.layoutRects.desktop } });
    expect(state.boxes.parent.archived).toBe(false);
    expect(state.boxes.child.archived).toBe(false);
  });

  it("records a default view for each device kind", () => {
    let state = initial();
    state = apply(state, { type: "view.create", payload: { viewId: "mobile", name: "Mobil" } });
    state = apply(state, { type: "view.setDeviceDefault", payload: { device: "mobile", viewId: "mobile" } });
    expect(state.deviceDefaults.mobile).toBe("mobile");
  });

  it("keeps independent geometry for each device layout", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.move", payload: { boxId: "parent", layout: "mobile", column: 12, row: 8 } });
    state = apply(state, { type: "layout.activate", payload: { device: "mobile" } });
    expect(state.activeLayout).toBe("mobile");
    expect(state.boxes.parent.layoutRects.mobile).toEqual({ column: 12, row: 8, width: 6, height: 6 });
    expect(state.boxes.parent.layoutRects.desktop).toEqual({ column: 0, row: 0, width: 6, height: 6 });
  });

  it("stores handle and box-name visibility through commands", () => {
    let state = initial();
    state = apply(state, { type: "workspace.handles.set", payload: { visible: false } });
    state = apply(state, { type: "workspace.names.set", payload: { visible: false } });
    expect(state.preferences).toEqual({ handlesVisible: false, namesVisible: false });
  });

  it("keeps a view control box synchronized when it is renamed", () => {
    let state = initial();
    const viewBox = Object.values(state.boxes).find((box) => box.role.type === "view");
    expect(viewBox).toBeDefined();
    state = apply(state, { type: "box.rename", payload: { boxId: viewBox!.id, name: "Kezdőlap" } });
    expect(state.views.main.name).toBe("Kezdőlap");
    expect(state.boxes[viewBox!.id].name).toBe("Kezdőlap");
  });

  it("deletes only leaf boxes so a subtree cannot disappear implicitly", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.nest", payload: { boxId: "child", parentId: "parent", layout: "desktop", rect: { column: 0, row: 0, width: 3, height: 3 } } });
    expect(() => apply(state, {
      type: "box.delete",
      payload: { boxId: "parent" },
    })).toThrowError(new DomainError("box.delete.hasChildren"));

    state = apply(state, { type: "box.delete", payload: { boxId: "child" } });
    expect(state.boxes.child).toBeUndefined();
    expect(state.boxes.parent).toBeDefined();
  });
});
