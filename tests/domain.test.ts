import { describe, expect, it } from "vitest";
import { applyWorkspaceCommand, createWorkspace, DomainError, type WorkspaceCommand, type WorkspaceState } from "@synaius/domain";

function initial() {
  return createWorkspace({
    workspaceId: "workspace",
    initialViewId: "main",
    initialViewName: "Alapnézet",
    cloneNameTemplates: { first: "{name} klónja", numbered: "{name} {count}. klónja" },
  });
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
    expect(state.schemaVersion).toBe(7);
    expect(state.activeLayout).toBe("desktop");
    expect(state.deviceDefaults).toEqual({ desktop: "main", tablet: "main", mobile: "main" });
    expect(state.views.main.grid.columns).toBe(24);
    expect(systemBoxes).toHaveLength(4);
    expect(systemBoxes.every((box) => box.viewId === null)).toBe(true);
    expect(systemBoxes.every((box) => box.labelKey && state.localeMessages[box.labelKey] === box.name)).toBe(true);
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

  it("cuts and pastes a box into another view without losing identity or style", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "view.create", payload: { viewId: "other", name: "Másik" } });
    state = apply(state, { type: "box.style.patch", payload: { boxId: "child", declarations: { color: "#fff" } } });
    state = apply(state, {
      type: "box.cutPaste",
      payload: {
        boxId: "child",
        targetViewId: "other",
        layout: "desktop",
        rect: { column: -6, row: -2, width: 3, height: 3 },
      },
    });
    expect(state.boxes.child.viewId).toBe("other");
    expect(state.boxes.child.layoutRects.desktop).toEqual({ column: -6, row: -2, width: 3, height: 3 });
    expect(state.boxes.child.style.declarations.color).toBe("#fff");
  });

  it("moves an entire nested subtree between views", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "view.create", payload: { viewId: "other", name: "Másik" } });
    state = apply(state, { type: "box.nest", payload: { boxId: "child", parentId: "parent", layout: "desktop", rect: { column: 2, row: 1, width: 4, height: 3 } } });
    state = apply(state, {
      type: "box.cutPaste",
      payload: { boxId: "parent", targetViewId: "other", layout: "desktop", rect: { column: 4, row: 5, width: 6, height: 6 } },
    });
    expect(state.boxes.parent.viewId).toBe("other");
    expect(state.boxes.child.viewId).toBe("other");
    expect(state.boxes.child.parentId).toBe("parent");
  });

  it("deep-clones a subtree and keeps clone names linked to their originals", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "view.create", payload: { viewId: "bedroom", name: "Hálószoba" } });
    state = apply(state, { type: "box.nest", payload: { boxId: "child", parentId: "parent", layout: "desktop", rect: { column: 2, row: 1, width: 4, height: 3 } } });
    state = apply(state, {
      type: "box.clonePaste",
      payload: {
        sourceBoxId: "parent",
        targetViewId: "bedroom",
        layout: "desktop",
        rect: { column: 12, row: 8, width: 6, height: 6 },
        idMap: { parent: "parent-clone", child: "child-clone" },
      },
    });
    expect(state.boxes["parent-clone"].name).toBe("Szülő klónja");
    expect(state.boxes["parent-clone"].cloneSourceId).toBe("parent");
    expect(state.boxes["parent-clone"].viewId).toBe("bedroom");
    expect(state.boxes["child-clone"].parentId).toBe("parent-clone");
    expect(state.boxes["child-clone"].cloneSourceId).toBe("child");

    state = apply(state, { type: "box.rename", payload: { boxId: "parent", name: "Főkapcsoló" } });
    expect(state.boxes["parent-clone"].name).toBe("Főkapcsoló klónja");
    expect(() => apply(state, {
      type: "box.rename",
      payload: { boxId: "parent-clone", name: "Külön név" },
    })).toThrowError(new DomainError("box.rename.clone"));

    state = apply(state, {
      type: "box.clonePaste",
      payload: {
        sourceBoxId: "parent",
        targetViewId: "main",
        layout: "desktop",
        rect: { column: 20, row: 8, width: 6, height: 6 },
        idMap: { parent: "parent-clone-2", child: "child-clone-2" },
      },
    });
    expect(state.boxes["parent-clone-2"].name).toBe("Főkapcsoló 2. klónja");
  });

  it("recomputes linked clone names when their localization template changes", () => {
    let state = withTwoBoxes();
    state = apply(state, {
      type: "box.clonePaste",
      payload: {
        sourceBoxId: "child",
        targetViewId: "main",
        layout: "desktop",
        rect: { column: 12, row: 4, width: 3, height: 3 },
        idMap: { child: "child-clone" },
      },
    });
    state = apply(state, {
      type: "localization.message.set",
      payload: { key: "workspace.box.cloneName", value: "{name} másolata" },
    });
    expect(state.boxes["child-clone"].name).toBe("Gyermek másolata");
  });

  it("turns a clone into an independent box when its original is deleted", () => {
    let state = withTwoBoxes();
    state = apply(state, {
      type: "box.clonePaste",
      payload: {
        sourceBoxId: "child",
        targetViewId: "main",
        layout: "desktop",
        rect: { column: 12, row: 4, width: 3, height: 3 },
        idMap: { child: "child-clone" },
      },
    });
    state = apply(state, { type: "box.delete", payload: { boxId: "child" } });
    expect(state.boxes["child-clone"].cloneSourceId).toBeNull();
    expect(state.boxes["child-clone"].cloneOrdinal).toBeNull();
    state = apply(state, { type: "box.rename", payload: { boxId: "child-clone", name: "Önálló kapcsoló" } });
    expect(state.boxes["child-clone"].name).toBe("Önálló kapcsoló");
  });

  it("records a default view for each device kind", () => {
    let state = initial();
    state = apply(state, { type: "view.create", payload: { viewId: "mobile", name: "Mobil" } });
    state = apply(state, { type: "view.setLayoutDefault", payload: { layoutId: "mobile", viewId: "mobile" } });
    expect(state.deviceDefaults.mobile).toBe("mobile");
  });

  it("keeps independent geometry for each device layout", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.move", payload: { boxId: "parent", layout: "mobile", column: 12, row: 8 } });
    state = apply(state, { type: "layout.activate", payload: { layoutId: "mobile" } });
    expect(state.activeLayout).toBe("mobile");
    expect(state.boxes.parent.layoutRects.mobile).toEqual({ column: 12, row: 8, width: 6, height: 6 });
    expect(state.boxes.parent.layoutRects.desktop).toEqual({ column: 0, row: 0, width: 6, height: 6 });
  });

  it("copies one box or an entire view between device layouts", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.move", payload: { boxId: "parent", layout: "desktop", column: 8, row: 9 } });
    state = apply(state, {
      type: "layout.copy",
      payload: { source: "desktop", target: "mobile", viewId: "main", boxId: "parent" },
    });
    expect(state.boxes.parent.layoutRects.mobile).toEqual(state.boxes.parent.layoutRects.desktop);
    expect(state.boxes.child.layoutRects.mobile).toEqual({ column: 6, row: 0, width: 3, height: 3 });
    state = apply(state, {
      type: "layout.copy",
      payload: { source: "desktop", target: "tablet", viewId: "main", boxId: null },
    });
    expect(state.boxes.parent.layoutRects.tablet).toEqual(state.boxes.parent.layoutRects.desktop);
    expect(state.boxes.child.layoutRects.tablet).toEqual(state.boxes.child.layoutRects.desktop);
  });

  it("creates a custom layout by copying an existing layout", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.move", payload: { boxId: "parent", layout: "desktop", column: 14, row: 3 } });
    state = apply(state, {
      type: "layout.create",
      payload: { layoutId: "custom:ultrawide", name: "UltraWide", sourceLayoutId: "desktop" },
    });
    expect(state.layoutOrder).toEqual(["desktop", "tablet", "mobile", "custom:ultrawide"]);
    expect(state.layouts["custom:ultrawide"]).toMatchObject({ name: "UltraWide", builtIn: false });
    expect(state.deviceDefaults["custom:ultrawide"]).toBe("main");
    expect(state.boxes.parent.layoutRects["custom:ultrawide"]).toEqual(state.boxes.parent.layoutRects.desktop);
    const control = Object.values(state.boxes)
      .find((box) => box.role.type === "device" && box.role.device === "custom:ultrawide");
    expect(control?.labelKey).toBe(state.layouts["custom:ultrawide"].labelKey);
    expect(state.localeMessages[state.layouts["custom:ultrawide"].labelKey]).toBe("UltraWide");
  });

  it("places a new layout control in a free global grid slot", () => {
    let state = initial();
    state = apply(state, { type: "view.create", payload: { viewId: "one", name: "Nézet 1" } });
    state = apply(state, { type: "view.create", payload: { viewId: "two", name: "Nézet 2" } });
    state = apply(state, {
      type: "layout.create",
      payload: { layoutId: "custom:ultrawide", name: "UltraWide", sourceLayoutId: "desktop" },
    });
    const control = Object.values(state.boxes)
      .find((box) => box.role.type === "device" && box.role.device === "custom:ultrawide")!;
    expect(control.layoutRects.desktop).toEqual({ column: 12, row: 2, width: 6, height: 2 });
  });

  it("protects built-in layouts and safely deletes custom layout geometry", () => {
    let state = withTwoBoxes();
    expect(() => apply(state, { type: "layout.delete", payload: { layoutId: "desktop" } }))
      .toThrowError(new DomainError("layout.delete.protected"));
    state = apply(state, {
      type: "layout.create",
      payload: { layoutId: "custom:wall", name: "Fali panel", sourceLayoutId: "tablet" },
    });
    state = apply(state, { type: "layout.activate", payload: { layoutId: "custom:wall" } });
    expect(() => apply(state, { type: "layout.delete", payload: { layoutId: "custom:wall" } }))
      .toThrowError(new DomainError("workspace.layout.delete.active"));
    state = apply(state, { type: "layout.activate", payload: { layoutId: "desktop" } });
    state = apply(state, { type: "layout.delete", payload: { layoutId: "custom:wall" } });
    expect(state.layouts["custom:wall"]).toBeUndefined();
    expect(state.deviceDefaults["custom:wall"]).toBeUndefined();
    expect(Object.values(state.boxes).every((box) => box.layoutRects["custom:wall"] === undefined)).toBe(true);
    expect(Object.values(state.boxes).some((box) => box.role.type === "device" && box.role.device === "custom:wall"))
      .toBe(false);
  });

  it("stores handle and box-name visibility through commands", () => {
    let state = initial();
    state = apply(state, { type: "workspace.handles.set", payload: { visible: false } });
    state = apply(state, { type: "workspace.names.set", payload: { visible: false } });
    expect(state.preferences).toEqual({ handlesVisible: false, namesVisible: false });
  });

  it("marks content and protected controls as hidden outside editing mode", () => {
    let state = withTwoBoxes();
    const deviceControl = Object.values(state.boxes).find((box) => box.role.type === "device")!;
    state = apply(state, {
      type: "box.visibility.set",
      payload: { boxId: "parent", hiddenWhenLocked: true },
    });
    state = apply(state, {
      type: "box.visibility.set",
      payload: { boxId: deviceControl.id, hiddenWhenLocked: true },
    });
    expect(state.boxes.parent.hiddenWhenLocked).toBe(true);
    expect(state.boxes[deviceControl.id].hiddenWhenLocked).toBe(true);
  });

  it("keeps a view control box synchronized when it is renamed", () => {
    let state = initial();
    const viewBox = Object.values(state.boxes).find((box) => box.role.type === "view");
    expect(viewBox).toBeDefined();
    state = apply(state, { type: "box.rename", payload: { boxId: viewBox!.id, name: "Kezdőlap" } });
    expect(state.views.main.name).toBe("Kezdőlap");
    expect(state.boxes[viewBox!.id].name).toBe("Kezdőlap");
  });

  it("stores editable system-box text under a stable localization key", () => {
    let state = initial();
    const deviceBox = Object.values(state.boxes).find((box) => box.role.type === "device" && box.role.device === "mobile");
    expect(deviceBox?.labelKey).toBeDefined();
    const originalName = deviceBox!.name;
    state = apply(state, {
      type: "localization.message.set",
      payload: { key: deviceBox!.labelKey!, value: "Telefonos elrendezés" },
    });
    expect(state.localeMessages[deviceBox!.labelKey!]).toBe("Telefonos elrendezés");
    expect(state.boxes[deviceBox!.id].name).toBe(originalName);
    expect(() => apply(state, {
      type: "localization.message.set",
      payload: { key: "workspace.box.missing.label", value: "Ismeretlen" },
    })).toThrowError(new DomainError("localization.key.notFound"));
  });

  it("deletes only leaf boxes so a subtree cannot disappear implicitly", () => {
    let state = withTwoBoxes();
    state = apply(state, { type: "box.nest", payload: { boxId: "child", parentId: "parent", layout: "desktop", rect: { column: 0, row: 0, width: 3, height: 3 } } });
    expect(() => apply(state, {
      type: "box.delete",
      payload: { boxId: "parent" },
    })).toThrowError(new DomainError("workspace.box.delete.hasChildren"));

    state = apply(state, { type: "box.delete", payload: { boxId: "child" } });
    expect(state.boxes.child).toBeUndefined();
    expect(state.boxes.parent).toBeDefined();
  });

  it("keeps content instances separate from box geometry and shares them with clones", () => {
    let state = withTwoBoxes();
    state = apply(state, {
      type: "content.create",
      payload: {
        content: {
          id: "content:panel",
          type: "core.html",
          rendererVersion: 1,
          configuration: { document: "<p></p>" },
          requiredPermissions: [],
          sourceNodeId: null,
        },
      },
    });
    state = apply(state, {
      type: "box.content.attach",
      payload: { boxId: "child", contentId: "content:panel" },
    });
    state = apply(state, {
      type: "box.clonePaste",
      payload: {
        sourceBoxId: "child",
        targetViewId: "main",
        layout: "desktop",
        rect: { column: 12, row: 4, width: 3, height: 3 },
        idMap: { child: "child-clone" },
      },
    });
    expect(state.boxes.child.contentId).toBe("content:panel");
    expect(state.boxes["child-clone"].contentId).toBe("content:panel");

    state = apply(state, {
      type: "content.configure",
      payload: { contentId: "content:panel", configuration: { document: "<section></section>" } },
    });
    expect(state.contents["content:panel"].revision).toBe(1);
    expect(() => apply(state, {
      type: "content.delete",
      payload: { contentId: "content:panel" },
    })).toThrowError(new DomainError("content.delete.inUse"));
  });
});
