import { describe, expect, it } from "vitest";
import { createWorkspace, type LegacyWorkspaceStateV3 } from "@synaius/domain";
import { createWorkspaceSnapshot, parseWorkspaceExport } from "../apps/portal/src/workspace-snapshots";

const deviceNames = { desktop: "Asztali gép", tablet: "Táblagép", mobile: "Mobiltelefon" };
const cloneNameTemplates = { first: "{name} klónja", numbered: "{name} {count}. klónja" };

describe("workspace snapshots", () => {
  it("creates an independent snapshot and accepts a valid export", () => {
    const workspace = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    const snapshot = createWorkspaceSnapshot(workspace, "  Első állapot  ");
    expect(snapshot.name).toBe("Első állapot");
    expect(snapshot.workspace).not.toBe(workspace);
    expect(parseWorkspaceExport(JSON.stringify(workspace), deviceNames, "desktop", cloneNameTemplates)).toEqual(workspace);
  });

  it("migrates a valid legacy export and rejects malformed data", () => {
    const current = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    const {
      schemaVersion: _schemaVersion,
      localeMessages: _localeMessages,
      layouts: _layouts,
      layoutOrder: _layoutOrder,
      boxes,
      ...base
    } = current;
    const legacy: LegacyWorkspaceStateV3 = {
      ...base,
      schemaVersion: 3,
      activeLayout: "desktop",
      deviceDefaults: { desktop: "main", tablet: "main", mobile: "main" },
      boxes: Object.fromEntries(Object.values(boxes).map((box) => {
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
    expect(parseWorkspaceExport(JSON.stringify(legacy), deviceNames, "desktop", cloneNameTemplates)?.schemaVersion).toBe(6);
    expect(parseWorkspaceExport("not-json", deviceNames, "desktop", cloneNameTemplates)).toBeNull();
    expect(parseWorkspaceExport(JSON.stringify({ schemaVersion: 2 }), deviceNames, "desktop", cloneNameTemplates)).toBeNull();
  });
});
