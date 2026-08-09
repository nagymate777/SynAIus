import type { SynAIusModuleManifest } from "@synaius/application";
import type { WorkspaceContentRenderContext } from "@synaius/workspace-ui";

export const ARTIFACT_VIEWER_CONTENT_TYPE = "module.artifact-viewer.file";
export const ARTIFACT_VIEWER_RENDERER_VERSION = 1;

export const artifactViewerModuleManifest: SynAIusModuleManifest = {
  id: "artifact-viewer",
  version: "0.2.0",
  localeNamespace: "module.artifact-viewer",
  contentTypes: [ARTIFACT_VIEWER_CONTENT_TYPE],
  permissions: ["artifact.thread-file.read"],
};

export interface OpenThreadFileArtifactInput {
  threadId: string;
  path: string;
  boxName: string;
}

export function openThreadFileArtifact(
  context: WorkspaceContentRenderContext,
  input: OpenThreadFileArtifactInput,
) {
  const existingContent = Object.values(context.workspace.contents).find((content) =>
    content.type === ARTIFACT_VIEWER_CONTENT_TYPE
    && content.configuration.provider === "thread-file"
    && content.configuration.threadId === input.threadId
    && sameArtifactPath(String(content.configuration.path ?? ""), input.path));
  const existingBox = existingContent
    ? Object.values(context.workspace.boxes).find((box) => box.contentId === existingContent.id)
    : null;
  if (existingBox) {
    context.focusBox(existingBox.id);
    return { action: "focused" as const, boxId: existingBox.id, contentId: existingContent!.id };
  }

  const contentId = `content:artifact:${crypto.randomUUID()}`;
  const boxId = `box:artifact:${crypto.randomUUID()}`;
  const sourceRect = context.box.layoutRects[context.workspace.activeLayout];
  const artifactCount = Object.values(context.workspace.contents)
    .filter((content) => content.type === ARTIFACT_VIEWER_CONTENT_TYPE).length;
  const offset = artifactCount % 4;

  context.execute("content.box.create", {
    content: {
      id: contentId,
      type: ARTIFACT_VIEWER_CONTENT_TYPE,
      rendererVersion: ARTIFACT_VIEWER_RENDERER_VERSION,
      configuration: {
        provider: "thread-file",
        threadId: input.threadId,
        path: input.path,
      },
      requiredPermissions: [...artifactViewerModuleManifest.permissions],
      sourceNodeId: null,
    },
    boxId,
    viewId: context.workspace.activeViewId,
    parentId: null,
    name: input.boxName,
    rect: {
      column: sourceRect.column + sourceRect.width + 1 + offset,
      row: sourceRect.row + offset,
      width: 14,
      height: 12,
    },
    grantedPermissions: [...artifactViewerModuleManifest.permissions],
  });
  return { action: "created" as const, boxId, contentId };
}

export function artifactFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function sameArtifactPath(left: string, right: string) {
  const normalizedLeft = left.replaceAll("\\", "/");
  const normalizedRight = right.replaceAll("\\", "/");
  if (/^[a-z]:\//i.test(normalizedLeft) || /^[a-z]:\//i.test(normalizedRight)) {
    return normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase();
  }
  return normalizedLeft === normalizedRight;
}
