import { describe, expect, it } from "vitest";
import {
  createWorkspace,
  migrateWorkspaceV1,
  migrateWorkspaceV2,
  migrateWorkspaceV3,
  migrateWorkspaceV4,
  type LegacyWorkspaceStateV1,
  type LegacyWorkspaceStateV2,
  type LegacyWorkspaceStateV3,
  type LegacyWorkspaceStateV4,
} from "@synaius/domain";
import {
  isLegacyWorkspaceState,
  isLegacyWorkspaceStateV2,
  isLegacyWorkspaceStateV3,
  isLegacyWorkspaceStateV4,
  isWorkspaceState,
} from "../apps/portal/src/workspace-storage";

describe("workspace storage validation", () => {
  it("accepts the current schema and rejects broken references", () => {
    const workspace = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    expect(isWorkspaceState(workspace)).toBe(true);
    expect(isWorkspaceState({ ...workspace, activeViewId: "missing" })).toBe(false);
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
    expect(migrated.schemaVersion).toBe(5);
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
    const { schemaVersion: _schemaVersion, localeMessages: _localeMessages, boxes: currentBoxes, ...base } = current;
    const previous: LegacyWorkspaceStateV3 = {
      ...base,
      schemaVersion: 3,
      boxes: Object.fromEntries(Object.values(currentBoxes).map((box) => {
        const { labelKey: _labelKey, cloneSourceId: _cloneSourceId, cloneOrdinal: _cloneOrdinal, ...legacyBox } = box;
        return [box.id, { ...legacyBox, archived: false }];
      })),
    };
    expect(isLegacyWorkspaceStateV3(previous)).toBe(true);
    const migrated = migrateWorkspaceV3(previous);
    const systemBoxes = Object.values(migrated.boxes).filter((box) => box.role.type !== "content");
    expect(migrated.schemaVersion).toBe(5);
    expect(systemBoxes.every((box) => box.labelKey && migrated.localeMessages[box.labelKey] === box.name)).toBe(true);
  });

  it("restores archived version-four boxes into regular views", () => {
    const current = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    const { schemaVersion: _schemaVersion, boxes, ...base } = current;
    const previous: LegacyWorkspaceStateV4 = {
      ...base,
      schemaVersion: 4,
      boxes: Object.fromEntries(Object.values(boxes).map((box) => {
        const { cloneSourceId: _cloneSourceId, cloneOrdinal: _cloneOrdinal, ...legacyBox } = box;
        return [box.id, { ...legacyBox, archived: true }];
      })),
    };
    expect(isLegacyWorkspaceStateV4(previous)).toBe(true);
    const migrated = migrateWorkspaceV4(previous, {
      first: "{name} klónja",
      numbered: "{name} {count}. klónja",
    });
    expect(migrated.schemaVersion).toBe(5);
    expect(Object.values(migrated.boxes).every((box) => !("archived" in box))).toBe(true);
    expect(Object.values(migrated.boxes).every((box) => box.cloneSourceId === null)).toBe(true);
  });
});
