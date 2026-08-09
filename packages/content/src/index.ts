export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ContentInstance {
  id: string;
  type: string;
  rendererVersion: number;
  revision: number;
  configuration: JsonObject;
  requiredPermissions: string[];
  sourceNodeId: string | null;
}

export interface ContentCatalogFieldDefinition {
  key: string;
  labelKey: string;
  placeholderKey?: string;
  input: "text" | "textarea";
  required: boolean;
}

export interface ContentCatalogDefinition {
  descriptionKey: string;
  defaultBoxNameKey: string;
  defaultWidth: number;
  defaultHeight: number;
  initialConfiguration: JsonObject;
  requiredPermissions: readonly string[];
  fields: readonly ContentCatalogFieldDefinition[];
}

export interface ContentRendererDefinition<TOutput = unknown, TContext = unknown> {
  type: string;
  moduleId: string;
  version: number;
  titleKey: string;
  catalog?: ContentCatalogDefinition;
  validateConfiguration(configuration: JsonObject): boolean;
  render(instance: ContentInstance, context: TContext): TOutput;
}

export type CatalogContentRendererDefinition<TOutput = unknown, TContext = unknown> =
  ContentRendererDefinition<TOutput, TContext> & { catalog: ContentCatalogDefinition };

export interface ContentRegistry<TOutput = unknown, TContext = unknown> {
  register(definition: ContentRendererDefinition<TOutput, TContext>): void;
  resolve(type: string, version?: number): ContentRendererDefinition<TOutput, TContext>;
  list(): ContentRendererDefinition<TOutput, TContext>[];
  listCatalog(): CatalogContentRendererDefinition<TOutput, TContext>[];
  createInstance(input: Omit<ContentInstance, "revision">): ContentInstance;
  validate(instance: ContentInstance): boolean;
  render(instance: ContentInstance, context: TContext): TOutput;
}

export class ContentContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function createContentRegistry<TOutput = unknown, TContext = unknown>(): ContentRegistry<TOutput, TContext> {
  const renderers = new Map<string, Map<number, ContentRendererDefinition<TOutput, TContext>>>();

  return {
    register(definition) {
      assertIdentifier(definition.type, "content.type.invalid");
      assertIdentifier(definition.moduleId, "content.module.invalid");
      if (!Number.isInteger(definition.version) || definition.version < 1) {
        throw new ContentContractError("content.renderer.version.invalid");
      }
      if (!definition.titleKey.trim()) throw new ContentContractError("content.renderer.titleKey.required");
      const catalog = definition.catalog ? normalizeCatalog(definition.catalog) : undefined;
      const versions = renderers.get(definition.type)
        ?? new Map<number, ContentRendererDefinition<TOutput, TContext>>();
      if (versions.has(definition.version)) throw new ContentContractError("content.renderer.duplicate");
      versions.set(definition.version, Object.freeze({ ...definition, catalog }));
      renderers.set(definition.type, versions);
    },

    resolve(type, version) {
      const versions = renderers.get(type);
      if (!versions?.size) throw new ContentContractError("content.renderer.notFound");
      const selectedVersion = version ?? Math.max(...versions.keys());
      const renderer = versions.get(selectedVersion);
      if (!renderer) throw new ContentContractError("content.renderer.version.notFound");
      return renderer;
    },

    list() {
      return [...renderers.values()]
        .flatMap((versions) => [...versions.values()])
        .sort((left, right) => left.type.localeCompare(right.type) || left.version - right.version);
    },

    listCatalog() {
      return [...renderers.values()]
        .map((versions) => versions.get(Math.max(...versions.keys())))
        .filter((definition): definition is CatalogContentRendererDefinition<TOutput, TContext> =>
          Boolean(definition?.catalog))
        .sort((left, right) => left.type.localeCompare(right.type));
    },

    createInstance(input) {
      assertIdentifier(input.id, "content.id.invalid");
      const instance: ContentInstance = structuredClone({ ...input, revision: 0 });
      if (!this.validate(instance)) throw new ContentContractError("content.configuration.invalid");
      return instance;
    },

    validate(instance) {
      if (!instance.id.trim() || !Number.isInteger(instance.revision) || instance.revision < 0) return false;
      if (!Array.isArray(instance.requiredPermissions)
        || instance.requiredPermissions.some((permission) => typeof permission !== "string" || !permission.trim())) return false;
      if (instance.sourceNodeId !== null && !instance.sourceNodeId.trim()) return false;
      try {
        return this.resolve(instance.type, instance.rendererVersion).validateConfiguration(instance.configuration);
      } catch {
        return false;
      }
    },

    render(instance, context) {
      if (!this.validate(instance)) throw new ContentContractError("content.configuration.invalid");
      return this.resolve(instance.type, instance.rendererVersion).render(instance, context);
    },
  };
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isJsonValue(value) && !Array.isArray(value) && value !== null;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function assertIdentifier(value: string, code: string) {
  if (!/^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/.test(value)) throw new ContentContractError(code);
}

function normalizeCatalog(catalog: ContentCatalogDefinition): ContentCatalogDefinition {
  if (!catalog.descriptionKey.trim()) throw new ContentContractError("content.catalog.descriptionKey.required");
  if (!catalog.defaultBoxNameKey.trim()) throw new ContentContractError("content.catalog.defaultBoxNameKey.required");
  if (!Number.isInteger(catalog.defaultWidth) || catalog.defaultWidth < 1
    || !Number.isInteger(catalog.defaultHeight) || catalog.defaultHeight < 1) {
    throw new ContentContractError("content.catalog.size.invalid");
  }
  if (!isJsonObject(catalog.initialConfiguration)) {
    throw new ContentContractError("content.catalog.configuration.invalid");
  }
  if (new Set(catalog.requiredPermissions).size !== catalog.requiredPermissions.length
    || catalog.requiredPermissions.some((permission) => typeof permission !== "string" || !permission.trim())) {
    throw new ContentContractError("content.catalog.permissions.invalid");
  }
  const fieldKeys = new Set<string>();
  const fields = catalog.fields.map((field) => {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(field.key)) {
      throw new ContentContractError("content.catalog.field.key.invalid");
    }
    if (fieldKeys.has(field.key)) throw new ContentContractError("content.catalog.field.duplicate");
    fieldKeys.add(field.key);
    if (!field.labelKey.trim() || (field.placeholderKey !== undefined && !field.placeholderKey.trim())) {
      throw new ContentContractError("content.catalog.field.localeKey.invalid");
    }
    if (field.input !== "text" && field.input !== "textarea") {
      throw new ContentContractError("content.catalog.field.input.invalid");
    }
    if (typeof catalog.initialConfiguration[field.key] !== "string") {
      throw new ContentContractError("content.catalog.field.configuration.invalid");
    }
    return Object.freeze({ ...field });
  });
  return Object.freeze({
    ...catalog,
    initialConfiguration: deepFreeze(structuredClone(catalog.initialConfiguration)),
    requiredPermissions: Object.freeze([...catalog.requiredPermissions]),
    fields: Object.freeze(fields),
  });
}

function deepFreeze<T extends JsonValue>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}
