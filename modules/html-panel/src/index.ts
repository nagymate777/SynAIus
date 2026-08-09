import type { SynAIusModuleManifest } from "@synaius/application";

export const HTML_PANEL_CONTENT_TYPE = "module.html-panel.document";
export const HTML_PANEL_RENDERER_VERSION = 1;

export const htmlPanelModuleManifest: SynAIusModuleManifest = {
  id: "html-panel",
  version: "0.1.0",
  localeNamespace: "module.html-panel",
  contentTypes: [HTML_PANEL_CONTENT_TYPE],
  permissions: [],
};
