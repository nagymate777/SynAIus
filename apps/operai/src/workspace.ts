import { applyWorkspaceCommand, type WorkspaceCommand, type WorkspaceState } from "@synaius/domain";
import {
  THREAD_STREAM_CONTENT_TYPE,
  THREAD_STREAM_RENDERER_VERSION,
  threadStreamModuleManifest,
} from "@synaius/module-thread-stream";
import hu from "../../../locales/hu.json";

export const OPERAI_THREAD_STREAM_CONTENT_ID = "content:operai-thread-stream";
export const OPERAI_THREAD_STREAM_BOX_ID = "box:operai-thread-stream";

export function initializeOperaiWorkspace(initial: WorkspaceState) {
  if (initial.contents[OPERAI_THREAD_STREAM_CONTENT_ID]) return initial;

  let workspace = execute(initial, "content.create", {
    content: {
      id: OPERAI_THREAD_STREAM_CONTENT_ID,
      type: THREAD_STREAM_CONTENT_TYPE,
      rendererVersion: THREAD_STREAM_RENDERER_VERSION,
      configuration: { threadId: null },
      requiredPermissions: [...threadStreamModuleManifest.permissions],
      sourceNodeId: null,
    },
  });
  workspace = execute(workspace, "box.create", {
    boxId: OPERAI_THREAD_STREAM_BOX_ID,
    viewId: workspace.activeViewId,
    parentId: null,
    name: hu["module.thread-stream.defaultBoxName"],
    rect: { column: 0, row: 4, width: 18, height: 16 },
  });
  return execute(workspace, "box.content.attach", {
    boxId: OPERAI_THREAD_STREAM_BOX_ID,
    contentId: OPERAI_THREAD_STREAM_CONTENT_ID,
  });
}

function execute<T extends WorkspaceCommand["type"]>(
  workspace: WorkspaceState,
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
