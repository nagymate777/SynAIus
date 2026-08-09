import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { SynAIusApplicationManifest } from "@synaius/application";
import type { ContentRegistry } from "@synaius/content";
import type { ReactNode } from "react";
import { WorkspaceApplication, type WorkspaceContentRenderContext } from "./WorkspaceApplication";
import "./styles.css";

export function mountWorkspaceApplication(
  root: HTMLElement,
  application: Readonly<SynAIusApplicationManifest>,
  contentRegistry?: ContentRegistry<ReactNode, WorkspaceContentRenderContext>,
) {
  createRoot(root).render(
    <StrictMode>
      <WorkspaceApplication application={application} contentRegistry={contentRegistry} />
    </StrictMode>,
  );
}
