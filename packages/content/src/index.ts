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

export interface ContentRendererDefinition<TOutput = unknown, TContext = unknown> {
  type: string;
  moduleId: string;
  version: number;
  titleKey: string;
  validateConfiguration(configuration: JsonObject): boolean;
  render(instance: ContentInstance, context: TContext): TOutput;
}

export interface ContentRegistry<TOutput = unknown, TContext = unknown> {
  register(definition: ContentRendererDefinition<TOutput, TContext>): void;
  resolve(type: string, version?: number): ContentRendererDefinition<TOutput, TContext>;
  list(): ContentRendererDefinition<TOutput, TContext>[];
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
      const versions = renderers.get(definition.type)
        ?? new Map<number, ContentRendererDefinition<TOutput, TContext>>();
      if (versions.has(definition.version)) throw new ContentContractError("content.renderer.duplicate");
      versions.set(definition.version, Object.freeze({ ...definition }));
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
