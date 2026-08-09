import type { SynAIusModuleManifest } from "@synaius/application";

export const WEB_PANEL_CONTENT_TYPE = "module.web-panel.page";
export const WEB_PANEL_RENDERER_VERSION = 1;
export const WEB_PANEL_EMBED_PERMISSION = "web.external.embed";

export const webPanelModuleManifest: SynAIusModuleManifest = {
  id: "web-panel",
  version: "0.1.0",
  localeNamespace: "module.web-panel",
  contentTypes: [WEB_PANEL_CONTENT_TYPE],
  permissions: [WEB_PANEL_EMBED_PERMISSION],
};
