import type { ReactNode } from "react";
import type { ContentRendererDefinition, JsonObject } from "@synaius/content";
import { createTranslator, type TranslationDictionary } from "@synaius/i18n";
import type { WorkspaceContentRenderContext } from "@synaius/workspace-ui";
import {
  WEB_PANEL_CONTENT_TYPE,
  WEB_PANEL_EMBED_PERMISSION,
  WEB_PANEL_RENDERER_VERSION,
  webPanelModuleManifest,
} from "./index.ts";
import "./web-panel.css";

export const WEB_PANEL_MAX_URL_LENGTH = 2_048;
export const WEB_PANEL_MAX_ORIGIN_LIST_LENGTH = 16_384;
export const WEB_PANEL_SANDBOX = "allow-forms allow-same-origin allow-scripts";

export interface WebPanelRendererOptions {
  localeMessages: TranslationDictionary;
  portalOrigin?: string;
}

export interface WebPanelConfiguration {
  url: string;
  allowedOrigins: string;
}

export type WebPanelTarget =
  | { status: "ready"; href: string; origin: string; host: string }
  | { status: "invalid" }
  | { status: "origin-not-allowed"; origin: string }
  | { status: "portal-origin-blocked"; origin: string };

export function createWebPanelRenderer(
  options: WebPanelRendererOptions,
): ContentRendererDefinition<ReactNode, WorkspaceContentRenderContext> {
  const t = createTranslator(options.localeMessages);
  return {
    type: WEB_PANEL_CONTENT_TYPE,
    moduleId: "web-panel",
    version: WEB_PANEL_RENDERER_VERSION,
    titleKey: "module.web-panel.title",
    catalog: {
      descriptionKey: "module.web-panel.catalog.description",
      defaultBoxNameKey: "module.web-panel.defaultBoxName",
      defaultWidth: 16,
      defaultHeight: 14,
      initialConfiguration: { url: "", allowedOrigins: "" },
      requiredPermissions: webPanelModuleManifest.permissions,
      permissions: [{
        id: WEB_PANEL_EMBED_PERMISSION,
        titleKey: "module.web-panel.permission.embed.title",
        descriptionKey: "module.web-panel.permission.embed.description",
      }],
      fields: [
        {
          key: "url",
          labelKey: "module.web-panel.catalog.url.label",
          placeholderKey: "module.web-panel.catalog.url.placeholder",
          input: "url",
          required: true,
        },
        {
          key: "allowedOrigins",
          labelKey: "module.web-panel.catalog.allowedOrigins.label",
          placeholderKey: "module.web-panel.catalog.allowedOrigins.placeholder",
          input: "textarea",
          required: true,
        },
      ],
    },
    validateConfiguration: isWebPanelConfiguration,
    render: (instance) => {
      const configuration = readWebPanelConfiguration(instance.configuration);
      const target = resolveWebPanelTarget(configuration, options.portalOrigin);
      if (target.status !== "ready") {
        const messageKey = target.status === "portal-origin-blocked"
          ? "module.web-panel.policy.portalOrigin"
          : target.status === "origin-not-allowed"
            ? "module.web-panel.policy.originNotAllowed"
            : "module.web-panel.policy.invalid";
        return (
          <section className="web-panel web-panel-policy" data-policy-status={target.status}>
            <strong>{t("module.web-panel.policy.title")}</strong>
            <p>{t(messageKey, { origin: "origin" in target ? target.origin : "" })}</p>
          </section>
        );
      }
      return (
        <section className="web-panel" data-policy-status="ready">
          <header>
            <span>{t("module.web-panel.origin", { origin: target.origin })}</span>
            <a href={target.href} rel="noopener noreferrer" target="_blank">
              {t("module.web-panel.action.openExternal")}
            </a>
          </header>
          <p className="web-panel-fallback">{t("module.web-panel.embedFallback")}</p>
          <iframe
            allow=""
            data-security-profile="external-sandbox"
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox={WEB_PANEL_SANDBOX}
            src={target.href}
            title={t("module.web-panel.frame.title", { host: target.host })}
          />
        </section>
      );
    },
  };
}

export function resolveWebPanelTarget(
  configuration: WebPanelConfiguration,
  portalOrigin?: string,
): WebPanelTarget {
  const target = parseNetworkUrl(configuration.url);
  const allowedOrigins = parseAllowedOrigins(configuration.allowedOrigins);
  if (!target || allowedOrigins === null) return { status: "invalid" };
  if (portalOrigin && normalizeOrigin(portalOrigin) === target.origin) {
    return { status: "portal-origin-blocked", origin: target.origin };
  }
  if (!allowedOrigins.includes(target.origin)) {
    return { status: "origin-not-allowed", origin: target.origin };
  }
  return { status: "ready", href: target.href, origin: target.origin, host: target.host };
}

export function parseAllowedOrigins(value: string) {
  const origins = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const normalized = origins.map(normalizeListedOrigin);
  if (normalized.some((origin) => origin === null)) return null;
  return [...new Set(normalized.filter((origin): origin is string => origin !== null))];
}

function isWebPanelConfiguration(configuration: JsonObject) {
  if (typeof configuration.url !== "string"
    || configuration.url.length > WEB_PANEL_MAX_URL_LENGTH
    || typeof configuration.allowedOrigins !== "string"
    || configuration.allowedOrigins.length > WEB_PANEL_MAX_ORIGIN_LIST_LENGTH) return false;
  return parseNetworkUrl(configuration.url) !== null
    && parseAllowedOrigins(configuration.allowedOrigins) !== null;
}

function readWebPanelConfiguration(configuration: JsonObject): WebPanelConfiguration {
  return {
    url: typeof configuration.url === "string" ? configuration.url : "",
    allowedOrigins: typeof configuration.allowedOrigins === "string" ? configuration.allowedOrigins : "",
  };
}

function parseNetworkUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function normalizeListedOrigin(value: string) {
  const url = parseNetworkUrl(value);
  if (!url
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash) return null;
  return url.origin;
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
