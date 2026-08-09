import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { SynAIusApplicationManifest } from "@synaius/application";
import type { ContentRegistry } from "@synaius/content";
import type { ReactNode } from "react";
import type { WorkspaceState } from "@synaius/domain";
import type { WorkspaceControlGateway } from "@synaius/workspace-control";
import { WorkspaceApplication, type WorkspaceContentRenderContext } from "./WorkspaceApplication";
import "./styles.css";

export interface WorkspaceMountOptions {
  contentRegistry?: ContentRegistry<ReactNode, WorkspaceContentRenderContext>;
  initializeWorkspace?: (workspace: WorkspaceState) => WorkspaceState;
  workspaceControl?: WorkspaceControlGateway;
}

export function mountWorkspaceApplication(
  root: HTMLElement,
  application: Readonly<SynAIusApplicationManifest>,
  options: WorkspaceMountOptions = {},
) {
  createRoot(root).render(
    <StrictMode>
      <WorkspaceApplication
        application={application}
        contentRegistry={options.contentRegistry}
        initializeWorkspace={options.initializeWorkspace}
        workspaceControl={options.workspaceControl}
      />
    </StrictMode>,
  );
}
