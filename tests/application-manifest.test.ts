import { describe, expect, it } from "vitest";
import { ApplicationManifestError, defineSynAIusApplication } from "@synaius/application";

const dictionary = {
  "app.studio.title": "SynAIus Studio",
  "workspace.view.defaultName": "Alapnézet",
};

describe("application manifest", () => {
  it("accepts an application that only declares shared modules", () => {
    const manifest = defineSynAIusApplication({
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
      localeMessages: dictionary,
    });
    expect(manifest.id).toBe("studio");
  });

  it("rejects application-owned keys outside the application namespace", () => {
    expect(() => defineSynAIusApplication({
      schemaVersion: 1,
      id: "studio",
      version: "0.0.0",
      locale: "hu",
      localeNamespace: "app.studio",
      titleKey: "app.operai.title",
      storageNamespace: "synaius",
      initialWorkspace: {
        workspaceId: "workspace-main",
        viewId: "view-main",
        viewTitleKey: "workspace.view.defaultName",
      },
      modules: [],
      localeMessages: dictionary,
    })).toThrowError(new ApplicationManifestError("application.localeKey.outOfNamespace"));
  });
});
