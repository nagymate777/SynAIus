import { defineSynAIusApplication } from "@synaius/application";
import hu from "../../../locales/hu.json";

export const studioApplication = defineSynAIusApplication({
  schemaVersion: 1,
  id: "studio",
  version: "0.0.0",
  locale: "hu",
  localeNamespace: "app.studio",
  titleKey: "app.studio.title",
  storageNamespace: "synaius",
  initialWorkspace: {
    workspaceId: "workspace-main",
    viewId: "view-main",
    viewTitleKey: "workspace.view.defaultName",
  },
  modules: [],
  localeMessages: hu,
});
