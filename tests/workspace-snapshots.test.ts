import { describe, expect, it } from "vitest";
import { createWorkspace, type LegacyWorkspaceStateV3 } from "@synaius/domain";
import { createWorkspaceSnapshot, parseWorkspaceExport } from "../apps/portal/src/workspace-snapshots";

const deviceNames = { desktop: "Asztali gép", tablet: "Táblagép", mobile: "Mobiltelefon" };

describe("workspace snapshots", () => {
  it("creates an independent snapshot and accepts a valid export", () => {
    const workspace = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    const snapshot = createWorkspaceSnapshot(workspace, "  Első állapot  ");
    expect(snapshot.name).toBe("Első állapot");
    expect(snapshot.workspace).not.toBe(workspace);
    expect(parseWorkspaceExport(JSON.stringify(workspace), deviceNames, "desktop")).toEqual(workspace);
  });

  it("migrates a valid legacy export and rejects malformed data", () => {
    const current = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    const { schemaVersion: _schemaVersion, localeMessages: _localeMessages, boxes, ...base } = current;
    const legacy: LegacyWorkspaceStateV3 = {
      ...base,
      schemaVersion: 3,
      boxes: Object.fromEntries(Object.values(boxes).map((box) => {
        const { labelKey: _labelKey, ...legacyBox } = box;
        return [box.id, legacyBox];
      })),
    };
    expect(parseWorkspaceExport(JSON.stringify(legacy), deviceNames, "desktop")?.schemaVersion).toBe(4);
    expect(parseWorkspaceExport("not-json", deviceNames, "desktop")).toBeNull();
    expect(parseWorkspaceExport(JSON.stringify({ schemaVersion: 2 }), deviceNames, "desktop")).toBeNull();
  });
});
