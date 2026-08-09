import { createContentRegistry } from "@synaius/content";
import {
  artifactFileName,
  openThreadFileArtifact,
} from "@synaius/module-artifact-viewer";
import { BrowserArtifactGateway } from "@synaius/module-artifact-viewer/client";
import { createArtifactViewerRenderer } from "@synaius/module-artifact-viewer/renderer";
import { createHtmlPanelRenderer } from "@synaius/module-html-panel/renderer";
import { BrowserThreadStreamGateway } from "@synaius/module-thread-stream/client";
import { createThreadStreamRenderer } from "@synaius/module-thread-stream/renderer";
import { createWebPanelRenderer } from "@synaius/module-web-panel/renderer";
import { createTranslator } from "@synaius/i18n";
import { mountWorkspaceApplication, type WorkspaceContentRenderContext } from "@synaius/workspace-ui";
import type { ReactNode } from "react";
import hu from "../../../locales/hu.json";
import { operaiApplication } from "./application";
import { initializeOperaiWorkspace } from "./workspace";

const root = document.getElementById("root");
if (!root) throw new Error("root.missing");
const contentRegistry = createContentRegistry<ReactNode, WorkspaceContentRenderContext>();
const t = createTranslator(hu);
contentRegistry.register(createArtifactViewerRenderer({
  gateway: new BrowserArtifactGateway(),
  localeMessages: hu,
}));
contentRegistry.register(createHtmlPanelRenderer({ localeMessages: hu }));
contentRegistry.register(createWebPanelRenderer({
  localeMessages: hu,
  portalOrigin: window.location.origin,
}));
contentRegistry.register(createThreadStreamRenderer({
  gateway: new BrowserThreadStreamGateway(),
  localeMessages: hu,
  onOpenFile: (input, context) => {
    const name = artifactFileName(input.path);
    const occupiedNames = new Set(Object.values(context.workspace.boxes).map((box) => box.name));
    let boxName = t("module.artifact-viewer.defaultBoxName", { name });
    let count = 2;
    while (occupiedNames.has(boxName)) {
      boxName = t("module.artifact-viewer.numberedBoxName", { name, count });
      count += 1;
    }
    openThreadFileArtifact(context, { ...input, boxName });
  },
}));
mountWorkspaceApplication(root, operaiApplication, {
  contentRegistry,
  initializeWorkspace: initializeOperaiWorkspace,
});
