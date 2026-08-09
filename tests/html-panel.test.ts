import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createContentRegistry } from "@synaius/content";
import {
  HTML_PANEL_CONTENT_TYPE,
  HTML_PANEL_RENDERER_VERSION,
  htmlPanelModuleManifest,
} from "@synaius/module-html-panel";
import {
  HTML_PANEL_CONTENT_SECURITY_POLICY,
  HTML_PANEL_MAX_HTML_LENGTH,
  buildHtmlPanelDocument,
  createHtmlPanelRenderer,
  sanitizePanelCss,
} from "@synaius/module-html-panel/renderer";
import type { WorkspaceContentRenderContext } from "@synaius/workspace-ui";
import hu from "../locales/hu.json";

describe("HTML panel", () => {
  it("registers as a catalog content type without external permissions", () => {
    const registry = createContentRegistry<ReactNode, WorkspaceContentRenderContext>();
    registry.register(createHtmlPanelRenderer({ localeMessages: hu }));

    expect(htmlPanelModuleManifest.permissions).toEqual([]);
    expect(registry.listCatalog()).toMatchObject([{
      type: HTML_PANEL_CONTENT_TYPE,
      version: HTML_PANEL_RENDERER_VERSION,
      catalog: {
        defaultWidth: 12,
        defaultHeight: 10,
        fields: [{ key: "html", input: "textarea" }, { key: "css", input: "textarea" }],
      },
    }]);
  });

  it("renders non-empty content only through a sandboxed, referrer-free iframe", () => {
    const renderer = createHtmlPanelRenderer({ localeMessages: hu });
    const instance = {
      id: "content:html-panel",
      type: HTML_PANEL_CONTENT_TYPE,
      rendererVersion: HTML_PANEL_RENDERER_VERSION,
      revision: 0,
      configuration: { html: "<h1>Panel</h1>", css: "h1 { color: teal; }" },
      requiredPermissions: [],
      sourceNodeId: null,
    };
    const section = renderer.render(instance, {} as WorkspaceContentRenderContext);
    expect(isValidElement(section)).toBe(true);
    const iframe = (section as ReactElement<{ children: ReactElement<Record<string, unknown>> }>).props.children;
    expect(isValidElement(iframe)).toBe(true);
    expect(iframe.props).toMatchObject({
      allow: "",
      "data-security-profile": "isolated",
      referrerPolicy: "no-referrer",
      sandbox: "",
    });
    expect(String(iframe.props.srcDoc)).toContain(HTML_PANEL_CONTENT_SECURITY_POLICY);
  });

  it("fails closed for oversized content and neutralizes active CSS/document escapes", () => {
    const registry = createContentRegistry<ReactNode, WorkspaceContentRenderContext>();
    registry.register(createHtmlPanelRenderer({ localeMessages: hu }));
    const oversized = registry.createInstance.bind(registry, {
      id: "content:oversized",
      type: HTML_PANEL_CONTENT_TYPE,
      rendererVersion: HTML_PANEL_RENDERER_VERSION,
      configuration: { html: "x".repeat(HTML_PANEL_MAX_HTML_LENGTH + 1), css: "" },
      requiredPermissions: [],
      sourceNodeId: null,
    });
    expect(oversized).toThrowError("content.configuration.invalid");

    const css = sanitizePanelCss('@import url("https://example.com/a.css"); body { background: url(https://example.com/a.png); }</style><script>alert(1)</script>');
    expect(css).not.toContain("@import");
    expect(css).not.toContain("url(");
    expect(css).not.toContain("</style><script>");

    const document = buildHtmlPanelDocument({
      html: '<script>alert(1)</script><style>@import "https://example.com/a.css";</style><img src="https://example.com/tracker.png">',
      css,
    });
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).not.toContain("</style><script>");
  });
});
