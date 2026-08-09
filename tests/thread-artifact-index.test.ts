import { describe, expect, it } from "vitest";
import {
  projectThreadArtifactFiles,
  type ThreadTurnGroup,
} from "@synaius/module-thread-stream/renderer";

describe("thread artifact index", () => {
  it("keeps one latest entry per file and counts changes across turns", () => {
    const turns: ThreadTurnGroup[] = [
      turn("turn-1", "change-1", [
        { path: "src/app.ts", kind: "add", diff: "+first" },
        { path: "docs/guide.md", kind: "add", diff: "+guide" },
      ]),
      turn("turn-2", "change-2", [
        { path: "src/app.ts", kind: "update", diff: "+second" },
      ]),
    ];

    expect(projectThreadArtifactFiles(turns)).toEqual([
      expect.objectContaining({
        path: "src/app.ts",
        name: "app.ts",
        changeKind: "update",
        diff: "+second",
        occurrences: 2,
        turnId: "turn-2",
        itemId: "change-2",
      }),
      expect.objectContaining({
        path: "docs/guide.md",
        name: "guide.md",
        changeKind: "add",
        occurrences: 1,
      }),
    ]);
  });
});

function turn(
  turnId: string,
  itemId: string,
  changes: Array<{
    path: string;
    kind: "add" | "update" | "delete" | "unknown";
    diff: string;
  }>,
): ThreadTurnGroup {
  return {
    id: turnId,
    status: "completed",
    error: null,
    durationMs: null,
    lines: [{
      id: itemId,
      kind: "activity",
      activity: {
        id: itemId,
        turnId,
        kind: "fileChange",
        status: "completed",
        changes,
      },
    }],
  };
}
