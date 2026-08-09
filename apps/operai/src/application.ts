import { defineSynAIusApplication } from "@synaius/application";
import { threadStreamModuleManifest } from "@synaius/module-thread-stream";
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
  modules: [threadStreamModuleManifest],
  localeMessages: hu,
});
