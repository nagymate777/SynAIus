import { describe, expect, it } from "vitest";
import {
  applyWorkspaceCommand,
  createWorkspace,
  migrateWorkspaceV1,
  migrateWorkspaceV2,
  migrateWorkspaceV3,
  migrateWorkspaceV4,
  migrateWorkspaceV5,
  type LegacyWorkspaceStateV1,
  type LegacyWorkspaceStateV2,
  type LegacyWorkspaceStateV3,
  type LegacyWorkspaceStateV4,
  type LegacyWorkspaceStateV5,
} from "@synaius/domain";
import {
  isLegacyWorkspaceState,
  isLegacyWorkspaceStateV2,
  isLegacyWorkspaceStateV3,
  isLegacyWorkspaceStateV4,
  isLegacyWorkspaceStateV5,
  isWorkspaceState,
} from "../apps/portal/src/workspace-storage";

describe("workspace storage validation", () => {
  it("accepts the current schema and rejects broken references", () => {
    const workspace = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    expect(isWorkspaceState(workspace)).toBe(true);
    expect(isWorkspaceState({ ...workspace, activeViewId: "missing" })).toBe(false);
  });

  it("validates persisted custom layouts and their per-box geometry", () => {
    const workspace = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    const withCustomLayout = applyWorkspaceCommand(workspace, {
      id: "create-ultrawide",
      expectedRevision: workspace.revision,
      type: "layout.create",
      payload: { layoutId: "custom:ultrawide", name: "UltraWide", sourceLayoutId: "desktop" },
    }).state;
    expect(isWorkspaceState(withCustomLayout)).toBe(true);
    const firstBox = Object.values(withCustomLayout.boxes)[0];
    const broken = structuredClone(withCustomLayout);
    delete broken.boxes[firstBox.id].layoutRects["custom:ultrawide"];
    expect(isWorkspaceState(broken)).toBe(false);
  });

  it("recognizes and migrates a version-one layout without losing content boxes", () => {
    const legacy: LegacyWorkspaceStateV1 = {
      schemaVersion: 1,
      id: "workspace",
      revision: 4,
      activeViewId: "main",
      deviceDefaults: { desktop: "main" },
      views: { main: { id: "main", name: "Alapnézet", grid: { columns: 12, visible: true } } },
      boxes: {
        content: {
          id: "content",
          viewId: "main",
          parentId: null,
          name: "Tartalom",
          rect: { column: 2, row: 1, width: 3, height: 2 },
          childGrid: { columns: 12, visible: false },
          style: { declarations: {}, scopedCss: "" },
          archived: false,
        },
      },
      globalStyle: { declarations: {}, scopedCss: "" },
    };
    expect(isLegacyWorkspaceState(legacy)).toBe(true);
    const migrated = migrateWorkspaceV1(legacy, { desktop: "Asztali gép", tablet: "Táblagép", mobile: "Mobiltelefon" });
    expect(migrated.boxes.content.layoutRects.desktop).toEqual({ column: 4, row: 2, width: 6, height: 4 });
    expect(migrated.boxes.content.layoutRects.mobile).toEqual({ column: 4, row: 2, width: 6, height: 4 });
    expect(migrated.boxes.content.role).toEqual({ type: "content" });
    expect(Object.values(migrated.boxes).filter((box) => box.role.type !== "content")).toHaveLength(4);
  });

  it("migrates version two geometry into every device layout", () => {
    const previous: LegacyWorkspaceStateV2 = {
      schemaVersion: 2,
      id: "workspace",
      revision: 8,
      activeViewId: "main",
      deviceDefaults: { desktop: "main" },
      views: { main: { id: "main", name: "Alapnézet", grid: { columns: 24, visible: false } } },
      boxes: {
        content: {
          id: "content",
          viewId: "main",
          parentId: null,
          name: "Tartalom",
          rect: { column: 3, row: 4, width: 5, height: 6 },
          childGrid: { columns: 24, visible: false },
          style: { declarations: {}, scopedCss: "" },
          role: { type: "content" },
          archived: false,
        },
      },
      preferences: { handlesVisible: true, namesVisible: true },
      globalStyle: { declarations: {}, scopedCss: "" },
    };
    expect(isLegacyWorkspaceStateV2(previous)).toBe(true);
    const migrated = migrateWorkspaceV2(previous, "tablet");
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.activeLayout).toBe("tablet");
    expect(migrated.deviceDefaults).toEqual({ desktop: "main", tablet: "main", mobile: "main" });
    expect(migrated.boxes.content.layoutRects).toEqual({
      desktop: previous.boxes.content.rect,
      tablet: previous.boxes.content.rect,
      mobile: previous.boxes.content.rect,
    });
  });

  it("adds stable localization keys while migrating version three", () => {
    const current = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    const {
      schemaVersion: _schemaVersion,
      localeMessages: _localeMessages,
      layouts: _layouts,
      layoutOrder: _layoutOrder,
      boxes: currentBoxes,
      ...base
    } = current;
    const previous: LegacyWorkspaceStateV3 = {
      ...base,
      schemaVersion: 3,
      activeLayout: "desktop",
      deviceDefaults: { desktop: "main", tablet: "main", mobile: "main" },
      boxes: Object.fromEntries(Object.values(currentBoxes).map((box) => {
        const {
          labelKey: _labelKey,
          cloneSourceId: _cloneSourceId,
          cloneOrdinal: _cloneOrdinal,
          hiddenWhenLocked: _hiddenWhenLocked,
          ...legacyBox
        } = box;
        return [box.id, { ...legacyBox, archived: false }];
      })),
    };
    expect(isLegacyWorkspaceStateV3(previous)).toBe(true);
    const migrated = migrateWorkspaceV3(previous);
    const systemBoxes = Object.values(migrated.boxes).filter((box) => box.role.type !== "content");
    expect(migrated.schemaVersion).toBe(6);
    expect(systemBoxes.every((box) => box.labelKey && migrated.localeMessages[box.labelKey] === box.name)).toBe(true);
  });

  it("restores archived version-four boxes into regular views", () => {
    const current = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    const {
      schemaVersion: _schemaVersion,
      layouts: _layouts,
      layoutOrder: _layoutOrder,
      boxes,
      ...base
    } = current;
    const previous: LegacyWorkspaceStateV4 = {
      ...base,
      schemaVersion: 4,
      activeLayout: "desktop",
      deviceDefaults: { desktop: "main", tablet: "main", mobile: "main" },
      boxes: Object.fromEntries(Object.values(boxes).map((box) => {
        const {
          cloneSourceId: _cloneSourceId,
          cloneOrdinal: _cloneOrdinal,
          hiddenWhenLocked: _hiddenWhenLocked,
          ...legacyBox
        } = box;
        return [box.id, { ...legacyBox, archived: true }];
      })),
    };
    expect(isLegacyWorkspaceStateV4(previous)).toBe(true);
    const migrated = migrateWorkspaceV4(previous, {
      first: "{name} klónja",
      numbered: "{name} {count}. klónja",
    });
    expect(migrated.schemaVersion).toBe(6);
    expect(Object.values(migrated.boxes).every((box) => !("archived" in box))).toBe(true);
    expect(Object.values(migrated.boxes).every((box) => box.cloneSourceId === null)).toBe(true);
  });

  it("migrates version five into dynamic protected layout profiles", () => {
    const current = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    const {
      schemaVersion: _schemaVersion,
      layouts: _layouts,
      layoutOrder: _layoutOrder,
      boxes,
      ...base
    } = current;
    const previous: LegacyWorkspaceStateV5 = {
      ...base,
      schemaVersion: 5,
      activeLayout: "desktop",
      deviceDefaults: { desktop: "main", tablet: "main", mobile: "main" },
      boxes: Object.fromEntries(Object.values(boxes).map((box) => {
        const { hiddenWhenLocked: _hiddenWhenLocked, ...legacyBox } = box;
        return [box.id, legacyBox];
      })),
    };
    expect(isLegacyWorkspaceStateV5(previous)).toBe(true);
    const migrated = migrateWorkspaceV5(previous);
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.layoutOrder).toEqual(["desktop", "tablet", "mobile"]);
    expect(Object.values(migrated.layouts).every((layout) => layout.builtIn)).toBe(true);
    expect(Object.values(migrated.boxes).every((box) => !box.hiddenWhenLocked)).toBe(true);
  });
});
