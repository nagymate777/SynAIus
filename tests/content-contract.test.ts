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

  it("publishes only the latest catalog entry as immutable declarative metadata", () => {
    const registry = createContentRegistry();
    const common = {
      type: "core.note",
      moduleId: "core",
      titleKey: "core.content.note.title",
      validateConfiguration: () => true,
      render: () => null,
    };
    registry.register({
      ...common,
      version: 1,
      catalog: {
        descriptionKey: "core.content.note.description",
        defaultBoxNameKey: "core.content.note.defaultName",
        defaultWidth: 6,
        defaultHeight: 4,
        initialConfiguration: { text: "" },
        requiredPermissions: [],
        fields: [{
          key: "text",
          labelKey: "core.content.note.text",
          input: "textarea" as const,
          required: false,
        }],
      },
    });
    registry.register({
      ...common,
      version: 2,
      catalog: {
        descriptionKey: "core.content.note.description",
        defaultBoxNameKey: "core.content.note.defaultName",
        defaultWidth: 8,
        defaultHeight: 5,
        initialConfiguration: { text: "" },
        requiredPermissions: ["note.read"],
        fields: [{
          key: "text",
          labelKey: "core.content.note.text",
          input: "textarea" as const,
          required: true,
        }],
      },
    });

    const catalog = registry.listCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ version: 2, catalog: { defaultWidth: 8 } });
    expect(Object.isFrozen(catalog[0]?.catalog)).toBe(true);
    expect(Object.isFrozen(catalog[0]?.catalog.initialConfiguration)).toBe(true);
    expect(Object.isFrozen(catalog[0]?.catalog.fields[0])).toBe(true);
  });

  it("rejects catalog fields that are not represented by string configuration values", () => {
    const registry = createContentRegistry();
    expect(() => registry.register({
      type: "core.invalid",
      moduleId: "core",
      version: 1,
      titleKey: "core.content.invalid.title",
      catalog: {
        descriptionKey: "core.content.invalid.description",
        defaultBoxNameKey: "core.content.invalid.defaultName",
        defaultWidth: 4,
        defaultHeight: 4,
        initialConfiguration: {},
        requiredPermissions: [],
        fields: [{
          key: "value",
          labelKey: "core.content.invalid.value",
          input: "text",
          required: true,
        }],
      },
      validateConfiguration: () => true,
      render: () => null,
    })).toThrowError(new ContentContractError("content.catalog.field.configuration.invalid"));
  });
});
