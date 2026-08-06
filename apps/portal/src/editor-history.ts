import type { WorkspaceState } from "@synaius/domain";

export interface EditorState {
  workspace: WorkspaceState;
  undo: WorkspaceState[];
  redo: WorkspaceState[];
}

const HISTORY_LIMIT = 100;

export function createEditorState(workspace: WorkspaceState): EditorState {
  return { workspace, undo: [], redo: [] };
}

export function commitEditorState(
  current: EditorState,
  transform: (workspace: WorkspaceState) => WorkspaceState,
  recordHistory = true,
): EditorState {
  const next = transform(current.workspace);
  if (next === current.workspace) return current;
  if (!recordHistory) return { ...current, workspace: next };
  return {
    workspace: next,
    undo: [...current.undo, current.workspace].slice(-HISTORY_LIMIT),
    redo: [],
  };
}

export function undoEditorState(current: EditorState): EditorState {
  if (!current.workspace.preferences.handlesVisible) return current;
  const target = current.undo.at(-1);
  if (!target) return current;
  return {
    workspace: workspaceForHistoryRestore(target, current.workspace),
    undo: current.undo.slice(0, -1),
    redo: [...current.redo, current.workspace].slice(-HISTORY_LIMIT),
  };
}

export function redoEditorState(current: EditorState): EditorState {
  if (!current.workspace.preferences.handlesVisible) return current;
  const target = current.redo.at(-1);
  if (!target) return current;
  return {
    workspace: workspaceForHistoryRestore(target, current.workspace),
    undo: [...current.undo, current.workspace].slice(-HISTORY_LIMIT),
    redo: current.redo.slice(0, -1),
  };
}

export function workspaceWithRevision(workspace: WorkspaceState, revision: number) {
  return { ...structuredClone(workspace), revision };
}

function workspaceForHistoryRestore(target: WorkspaceState, current: WorkspaceState) {
  const restored = workspaceWithRevision(target, current.revision + 1);
  restored.activeLayout = current.activeLayout;
  restored.preferences = structuredClone(current.preferences);
  if (restored.views[current.activeViewId]) restored.activeViewId = current.activeViewId;
  for (const [viewId, view] of Object.entries(restored.views)) {
    const currentView = current.views[viewId];
    if (currentView) view.grid.visible = currentView.grid.visible;
  }
  return restored;
}
