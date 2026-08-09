import type { ReactNode } from "react";
import type { ContentRendererDefinition, JsonObject } from "@synaius/content";
import { createTranslator, type TranslationDictionary } from "@synaius/i18n";
import type { WorkspaceContentRenderContext } from "@synaius/workspace-ui";
import {
  HTML_PANEL_CONTENT_TYPE,
  HTML_PANEL_RENDERER_VERSION,
  htmlPanelModuleManifest,
} from "./index.ts";
import "./html-panel.css";

export const HTML_PANEL_MAX_HTML_LENGTH = 250_000;
export const HTML_PANEL_MAX_CSS_LENGTH = 100_000;

export const HTML_PANEL_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "img-src data:",
  "media-src data:",
  "font-src data:",
  "style-src 'unsafe-inline'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'",
].join("; ");

const FORBIDDEN_ELEMENTS = "script, style, iframe, frame, frameset, object, embed, base, meta, link";
const URL_ATTRIBUTES = new Set(["background", "href", "xlink:href", "src", "poster"]);
const REMOVED_ATTRIBUTES = new Set(["action", "formaction", "ping", "srcdoc", "srcset"]);

export interface HtmlPanelRendererOptions {
  localeMessages: TranslationDictionary;
}

export function createHtmlPanelRenderer(
  options: HtmlPanelRendererOptions,
): ContentRendererDefinition<ReactNode, WorkspaceContentRenderContext> {
  const t = createTranslator(options.localeMessages);
  return {
    type: HTML_PANEL_CONTENT_TYPE,
    moduleId: "html-panel",
    version: HTML_PANEL_RENDERER_VERSION,
    titleKey: "module.html-panel.title",
    catalog: {
      descriptionKey: "module.html-panel.catalog.description",
      defaultBoxNameKey: "module.html-panel.defaultBoxName",
      defaultWidth: 12,
      defaultHeight: 10,
      initialConfiguration: { html: "", css: "" },
      requiredPermissions: htmlPanelModuleManifest.permissions,
      fields: [
        {
          key: "html",
          labelKey: "module.html-panel.catalog.html.label",
          placeholderKey: "module.html-panel.catalog.html.placeholder",
          input: "textarea",
          required: false,
        },
        {
          key: "css",
          labelKey: "module.html-panel.catalog.css.label",
          placeholderKey: "module.html-panel.catalog.css.placeholder",
          input: "textarea",
          required: false,
        },
      ],
    },
    validateConfiguration: isHtmlPanelConfiguration,
    render: (instance) => {
      const configuration = readHtmlPanelConfiguration(instance.configuration);
      return (
        <section className="html-panel">
          {configuration.html.trim() ? (
            <iframe
              allow=""
              data-security-profile="isolated"
              referrerPolicy="no-referrer"
              sandbox=""
              srcDoc={buildHtmlPanelDocument(configuration)}
              title={t("module.html-panel.frame.title")}
            />
          ) : (
            <p>{t("module.html-panel.empty")}</p>
          )}
        </section>
      );
    },
  };
}

export function buildHtmlPanelDocument(configuration: { html: string; css: string }) {
  const html = sanitizePanelHtml(configuration.html);
  const css = sanitizePanelCss(configuration.css);
  return [
    "<!doctype html>",
    "<html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${HTML_PANEL_CONTENT_SECURITY_POLICY}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${defaultPanelCss()}${css}</style>`,
    "</head><body>",
    html,
    "</body></html>",
  ].join("");
}

export function sanitizePanelHtml(html: string) {
  if (typeof document === "undefined") return escapeHtml(html);
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll(FORBIDDEN_ELEMENTS).forEach((element) => element.remove());
  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLocaleLowerCase();
      if (name.startsWith("on") || REMOVED_ATTRIBUTES.has(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (/(?:@import|url\s*\()/i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && !safePanelUrl(element.tagName, name, attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return template.innerHTML;
}

export function sanitizePanelCss(css: string) {
  return css
    .replace(/@import\s+(?:url\s*\()?[^;]+;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/<\/style/gi, "<\\/style");
}

function isHtmlPanelConfiguration(configuration: JsonObject) {
  return typeof configuration.html === "string"
    && configuration.html.length <= HTML_PANEL_MAX_HTML_LENGTH
    && typeof configuration.css === "string"
    && configuration.css.length <= HTML_PANEL_MAX_CSS_LENGTH;
}

function readHtmlPanelConfiguration(configuration: JsonObject) {
  return {
    html: typeof configuration.html === "string" ? configuration.html : "",
    css: typeof configuration.css === "string" ? configuration.css : "",
  };
}

function safePanelUrl(tagName: string, attributeName: string, value: string) {
  const normalized = value.trim();
  if ((attributeName === "href" || attributeName === "xlink:href") && normalized.startsWith("#")) return true;
  if (attributeName === "src" && tagName.toLocaleLowerCase() === "img") {
    return /^data:image\/(?:png|gif|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(normalized);
  }
  return false;
}

function defaultPanelCss() {
  return "html,body{box-sizing:border-box;min-height:100%;margin:0;}*,*::before,*::after{box-sizing:inherit;}body{font-family:system-ui,sans-serif;}";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
