import { defineSynAIusApplication } from "@synaius/application";
import { artifactViewerModuleManifest } from "@synaius/module-artifact-viewer";
import { htmlPanelModuleManifest } from "@synaius/module-html-panel";
import { threadStreamModuleManifest } from "@synaius/module-thread-stream";
import { webPanelModuleManifest } from "@synaius/module-web-panel";
import hu from "../../../locales/hu.json";

export const operaiApplication = defineSynAIusApplication({
  schemaVersion: 1,
  id: "operai",
  version: "0.0.0",
  locale: "hu",
  localeNamespace: "app.operai",
  titleKey: "app.operai.title",
  storageNamespace: "synaius.operai",
  initialWorkspace: {
    workspaceId: "operai-workspace-main",
    viewId: "operai-view-main",
    viewTitleKey: "app.operai.initialView",
  },
  modules: [artifactViewerModuleManifest, htmlPanelModuleManifest, threadStreamModuleManifest, webPanelModuleManifest],
  localeMessages: hu,
});
