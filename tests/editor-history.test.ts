import { describe, expect, it } from "vitest";
import { applyWorkspaceCommand, createWorkspace, type WorkspaceCommand } from "@synaius/domain";
import {
  commitEditorState,
  createEditorState,
  redoEditorState,
  undoEditorState,
} from "../apps/portal/src/editor-history";

function applyCommand<T extends WorkspaceCommand["type"]>(
  workspace: ReturnType<typeof createWorkspace>,
  type: T,
  payload: Extract<WorkspaceCommand, { type: T }>["payload"],
) {
  return applyWorkspaceCommand(workspace, {
    id: crypto.randomUUID(),
    expectedRevision: workspace.revision,
    type,
    payload,
  } as WorkspaceCommand).state;
}

describe("editor history", () => {
  it("undoes content while preserving navigation and interface preferences", () => {
    const workspace = createWorkspace({
      workspaceId: "workspace",
      initialViewId: "main",
      initialViewName: "Alapnézet",
    });
    let editor = createEditorState(workspace);
    editor = commitEditorState(editor, (current) => applyCommand(current, "box.create", {
      boxId: "content",
      viewId: "main",
      parentId: null,
      name: "Tartalom",
      rect: { column: 0, row: 4, width: 6, height: 4 },
    }));
    editor = commitEditorState(editor, (current) => applyCommand(current, "layout.activate", {
      device: "mobile",
    }), false);
    editor = commitEditorState(editor, (current) => applyCommand(current, "workspace.names.set", {
      visible: false,
    }), false);

    editor = undoEditorState(editor);
    expect(editor.workspace.boxes.content).toBeUndefined();
    expect(editor.workspace.activeLayout).toBe("mobile");
    expect(editor.workspace.preferences.namesVisible).toBe(false);

    editor = redoEditorState(editor);
    expect(editor.workspace.boxes.content).toBeDefined();
    expect(editor.workspace.activeLayout).toBe("mobile");
    expect(editor.workspace.preferences.namesVisible).toBe(false);
  });

  it("does not undo while editing is locked", () => {
    const workspace = createWorkspace({
      workspaceId: "workspace",
      initialViewId: "main",
      initialViewName: "Alapnézet",
    });
    let editor = createEditorState(workspace);
    editor = commitEditorState(editor, (current) => applyCommand(current, "box.create", {
      boxId: "content",
      viewId: "main",
      parentId: null,
      name: "Tartalom",
      rect: { column: 0, row: 4, width: 6, height: 4 },
    }));
    editor = commitEditorState(editor, (current) => applyCommand(current, "workspace.handles.set", {
      visible: false,
    }), false);
    expect(undoEditorState(editor)).toBe(editor);
  });
});
