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
    state = apply(state, { type: "box.nest", payload: { boxId: "child", parentId: "parent", rect: { column: 2, row: 1, width: 4, height: 3 } } });
    state = apply(state, { type: "box.move", payload: { boxId: "parent", column: 3, row: 4 } });
    expect(state.boxes.child.parentId).toBe("parent");
    expect(state.boxes.child.rect).toEqual({ column: 2, row: 1, width: 4, height: 3 });
  });

  it("prevents parent cycles", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.nest", payload: { boxId: "child", parentId: "parent", rect: { column: 0, row: 0, width: 3, height: 3 } } });
    expect(() => apply(state, {
      type: "box.nest",
      payload: { boxId: "parent", parentId: "child", rect: { column: 0, row: 0, width: 3, height: 3 } },
    })).toThrowError(new DomainError("box.parent.cycle"));
  });

  it("archives and restores a box without deleting its identity or style", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.style.patch", payload: { boxId: "child", declarations: { color: "#fff" } } });
    state = apply(state, { type: "box.archive", payload: { boxId: "child" } });
    expect(state.boxes.child.archived).toBe(true);
    state = apply(state, { type: "box.restore", payload: { boxId: "child", parentId: null, rect: { column: 6, row: 0, width: 3, height: 3 } } });
    expect(state.boxes.child.archived).toBe(false);
    expect(state.boxes.child.style.declarations.color).toBe("#fff");
  });

  it("records a default view for each device kind", () => {
    let state = initial();
    state = apply(state, { type: "view.create", payload: { viewId: "mobile", name: "Mobil" } });
    state = apply(state, { type: "view.setDeviceDefault", payload: { device: "mobile", viewId: "mobile" } });
    expect(state.deviceDefaults.mobile).toBe("mobile");
  });

  it("deletes only leaf boxes so a subtree cannot disappear implicitly", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.nest", payload: { boxId: "child", parentId: "parent", rect: { column: 0, row: 0, width: 3, height: 3 } } });
    expect(() => apply(state, {
      type: "box.delete",
      payload: { boxId: "parent" },
    })).toThrowError(new DomainError("box.delete.hasChildren"));

    state = apply(state, { type: "box.delete", payload: { boxId: "child" } });
    expect(state.boxes.child).toBeUndefined();
    expect(state.boxes.parent).toBeDefined();
  });
});
