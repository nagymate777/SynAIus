import { describe, expect, it } from "vitest";
import { applyWorkspaceCommand, createWorkspace, type WorkspaceCommand } from "@synaius/domain";
import {
  commitEditorState,
  createEditorState,
  redoEditorState,
  undoEditorState,
} from "@synaius/workspace-ui";

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
      layoutId: "mobile",
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

  it("undoes and redoes content configuration changes", () => {
    const workspace = createWorkspace({
      workspaceId: "workspace",
      initialViewId: "main",
      initialViewName: "Alapnézet",
    });
    let editor = createEditorState(workspace);
    editor = commitEditorState(editor, (current) => applyCommand(current, "content.box.create", {
      content: {
        id: "content:artifact",
        type: "module.artifact-viewer.file",
        rendererVersion: 1,
        configuration: { provider: "thread-file", threadId: "thread-1", path: "first.txt" },
        requiredPermissions: ["artifact.thread-file.read"],
        sourceNodeId: null,
      },
      boxId: "box:artifact",
      viewId: "main",
      parentId: null,
      name: "Fájlmegjelenítő",
      rect: { column: 0, row: 4, width: 14, height: 12 },
    }));
    editor = commitEditorState(editor, (current) => applyCommand(current, "content.configure", {
      contentId: "content:artifact",
      configuration: { provider: "thread-file", threadId: "thread-2", path: "second.txt" },
    }));

    expect(editor.workspace.contents["content:artifact"]?.configuration).toMatchObject({
      threadId: "thread-2",
      path: "second.txt",
    });
    editor = undoEditorState(editor);
    expect(editor.workspace.contents["content:artifact"]?.configuration).toMatchObject({
      threadId: "thread-1",
      path: "first.txt",
    });
    editor = redoEditorState(editor);
    expect(editor.workspace.contents["content:artifact"]?.configuration).toMatchObject({
      threadId: "thread-2",
      path: "second.txt",
    });
  });

  it("falls back to a valid layout when undo removes the active custom layout", () => {
    const workspace = createWorkspace({
      workspaceId: "workspace",
      initialViewId: "main",
      initialViewName: "Alapnézet",
    });
    let editor = createEditorState(workspace);
    editor = commitEditorState(editor, (current) => applyCommand(current, "layout.create", {
      layoutId: "custom:ultrawide",
      name: "UltraWide",
      sourceLayoutId: "desktop",
    }));
    editor = commitEditorState(editor, (current) => applyCommand(current, "layout.activate", {
      layoutId: "custom:ultrawide",
    }), false);
    editor = undoEditorState(editor);
    expect(editor.workspace.layouts["custom:ultrawide"]).toBeUndefined();
    expect(editor.workspace.activeLayout).toBe("desktop");
  });
});
