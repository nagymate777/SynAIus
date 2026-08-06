import { describe, expect, it } from "vitest";
import { createWorkspace, migrateWorkspaceV1, type LegacyWorkspaceStateV1 } from "@synaius/domain";
import { isLegacyWorkspaceState, isWorkspaceState } from "../apps/portal/src/workspace-storage";

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
    expect(migrated.boxes.content.rect).toEqual({ column: 4, row: 2, width: 6, height: 4 });
    expect(migrated.boxes.content.role).toEqual({ type: "content" });
    expect(Object.values(migrated.boxes).filter((box) => box.role.type !== "content")).toHaveLength(4);
  });
});
