import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { SynAIusApplicationManifest } from "@synaius/application";
import type { ContentRegistry } from "@synaius/content";
import type { ReactNode } from "react";
import type { WorkspaceState } from "@synaius/domain";
import { WorkspaceApplication, type WorkspaceContentRenderContext } from "./WorkspaceApplication";
import "./styles.css";

export interface WorkspaceMountOptions {
  contentRegistry?: ContentRegistry<ReactNode, WorkspaceContentRenderContext>;
  initializeWorkspace?: (workspace: WorkspaceState) => WorkspaceState;
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
      />
    </StrictMode>,
  );
}
