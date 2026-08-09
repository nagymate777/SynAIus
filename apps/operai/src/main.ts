import { createContentRegistry } from "@synaius/content";
import { BrowserThreadStreamGateway } from "@synaius/module-thread-stream/client";
import { createThreadStreamRenderer } from "@synaius/module-thread-stream/renderer";
import { mountWorkspaceApplication, type WorkspaceContentRenderContext } from "@synaius/workspace-ui";
import type { ReactNode } from "react";
import hu from "../../../locales/hu.json";
import { operaiApplication } from "./application";
import { initializeOperaiWorkspace } from "./workspace";

const root = document.getElementById("root");
if (!root) throw new Error("root.missing");
const contentRegistry = createContentRegistry<ReactNode, WorkspaceContentRenderContext>();
contentRegistry.register(createThreadStreamRenderer({
  gateway: new BrowserThreadStreamGateway(),
  localeMessages: hu,
}));
mountWorkspaceApplication(root, operaiApplication, {
  contentRegistry,
  initializeWorkspace: initializeOperaiWorkspace,
});
