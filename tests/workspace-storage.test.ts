import { describe, expect, it } from "vitest";
import { createWorkspace } from "@synaius/domain";
import { isWorkspaceState } from "../apps/portal/src/workspace-storage";

describe("workspace storage validation", () => {
  it("accepts the current schema and rejects broken references", () => {
    const workspace = createWorkspace({ workspaceId: "workspace", initialViewId: "main", initialViewName: "Alapnézet" });
    expect(isWorkspaceState(workspace)).toBe(true);
    expect(isWorkspaceState({ ...workspace, activeViewId: "missing" })).toBe(false);
  });
});
