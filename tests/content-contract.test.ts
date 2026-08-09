import { describe, expect, it } from "vitest";
import { ContentContractError, createContentRegistry } from "@synaius/content";

describe("content renderer contract", () => {
  it("resolves the latest compatible renderer and validates instances", () => {
    const registry = createContentRegistry();
    registry.register({
      type: "core.html",
      moduleId: "core",
      version: 1,
      titleKey: "core.content.html.title",
      validateConfiguration: (configuration) => typeof configuration.html === "string",
      render: () => "html-v1",
    });
    registry.register({
      type: "core.html",
      moduleId: "core",
      version: 2,
      titleKey: "core.content.html.title",
      validateConfiguration: (configuration) => typeof configuration.document === "string",
      render: (content) => content.configuration.document,
    });

    const instance = registry.createInstance({
      id: "content:welcome",
      type: "core.html",
      rendererVersion: 2,
      configuration: { document: "<p></p>" },
      requiredPermissions: [],
      sourceNodeId: null,
    });

    expect(instance.revision).toBe(0);
    expect(registry.resolve("core.html").version).toBe(2);
    expect(registry.validate(instance)).toBe(true);
    expect(registry.render(instance, {})).toBe("<p></p>");
  });

  it("rejects duplicate renderer versions", () => {
    const registry = createContentRegistry();
    const definition = {
      type: "module.thread-stream",
      moduleId: "threads",
      version: 1,
      titleKey: "module.threads.content.stream.title",
      validateConfiguration: () => true,
      render: () => null,
    };
    registry.register(definition);
    expect(() => registry.register(definition)).toThrowError(new ContentContractError("content.renderer.duplicate"));
  });
});
