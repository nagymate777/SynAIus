import type { TranslationDictionary } from "@synaius/i18n";

export interface SynAIusModuleManifest {
  id: string;
  version: string;
  localeNamespace: `module.${string}`;
  contentTypes: readonly string[];
  permissions: readonly string[];
}

export interface SynAIusApplicationManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  locale: "hu";
  localeNamespace: `app.${string}`;
  titleKey: string;
  storageNamespace: string;
  initialWorkspace: {
    workspaceId: string;
    viewId: string;
    viewTitleKey: string;
  };
  modules: readonly SynAIusModuleManifest[];
  localeMessages: TranslationDictionary;
}

export class ApplicationManifestError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function defineSynAIusApplication(
  manifest: SynAIusApplicationManifest,
): Readonly<SynAIusApplicationManifest> {
  assertIdentifier(manifest.id, "application.id.invalid");
  if (manifest.schemaVersion !== 1) throw new ApplicationManifestError("application.schema.unsupported");
  if (!manifest.version.trim()) throw new ApplicationManifestError("application.version.required");
  if (!Object.values(manifest.localeMessages).every((message) => typeof message === "string" && message.trim())) {
    throw new ApplicationManifestError("application.localeMessages.invalid");
  }
  if (manifest.localeNamespace !== `app.${manifest.id}`) {
    throw new ApplicationManifestError("application.localeNamespace.invalid");
  }
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(manifest.storageNamespace)) {
    throw new ApplicationManifestError("application.storageNamespace.invalid");
  }
  assertApplicationKey(manifest, manifest.titleKey);
  assertApplicationKey(manifest, manifest.initialWorkspace.viewTitleKey, true);
  if (!manifest.initialWorkspace.workspaceId.trim() || !manifest.initialWorkspace.viewId.trim()) {
    throw new ApplicationManifestError("application.initialWorkspace.invalid");
  }

  const moduleIds = new Set<string>();
  const contentTypes = new Set<string>();
  for (const module of manifest.modules) {
    assertIdentifier(module.id, "module.id.invalid");
    if (!module.version.trim()) throw new ApplicationManifestError("module.version.required");
    if (moduleIds.has(module.id)) throw new ApplicationManifestError("module.id.duplicate");
    if (module.localeNamespace !== `module.${module.id}`) {
      throw new ApplicationManifestError("module.localeNamespace.invalid");
    }
    moduleIds.add(module.id);
    for (const type of module.contentTypes) {
      if (!/^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/.test(type)) {
        throw new ApplicationManifestError("module.contentType.invalid");
      }
      if (contentTypes.has(type)) throw new ApplicationManifestError("module.contentType.duplicate");
      contentTypes.add(type);
    }
    if (new Set(module.permissions).size !== module.permissions.length
      || module.permissions.some((permission) => !permission.trim())) {
      throw new ApplicationManifestError("module.permissions.invalid");
    }
  }

  return Object.freeze({
    ...manifest,
    initialWorkspace: Object.freeze({ ...manifest.initialWorkspace }),
    modules: Object.freeze(manifest.modules.map((module) => Object.freeze({
      ...module,
      contentTypes: Object.freeze([...module.contentTypes]),
      permissions: Object.freeze([...module.permissions]),
    }))),
    localeMessages: Object.freeze({ ...manifest.localeMessages }),
  });
}

function assertApplicationKey(
  manifest: SynAIusApplicationManifest,
  key: string,
  allowWorkspaceKey = false,
) {
  if (!key.startsWith(`${manifest.localeNamespace}.`)
    && !(allowWorkspaceKey && key.startsWith("workspace."))) {
    throw new ApplicationManifestError("application.localeKey.outOfNamespace");
  }
  if (typeof manifest.localeMessages[key] !== "string") {
    throw new ApplicationManifestError("application.localeKey.missing");
  }
}

function assertIdentifier(value: string, code: string) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) throw new ApplicationManifestError(code);
}
