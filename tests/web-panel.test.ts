import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createContentRegistry } from "@synaius/content";
import {
  WEB_PANEL_CONTENT_TYPE,
  WEB_PANEL_EMBED_PERMISSION,
  WEB_PANEL_RENDERER_VERSION,
  webPanelModuleManifest,
} from "@synaius/module-web-panel";
import {
  WEB_PANEL_SANDBOX,
  createWebPanelRenderer,
  parseAllowedOrigins,
  resolveWebPanelTarget,
} from "@synaius/module-web-panel/renderer";
import type { WorkspaceContentRenderContext } from "@synaius/workspace-ui";
import hu from "../locales/hu.json";

describe("web panel", () => {
  it("registers as an explicit network-permission catalog content type", () => {
    const registry = createContentRegistry<ReactNode, WorkspaceContentRenderContext>();
    registry.register(createWebPanelRenderer({
      localeMessages: hu,
      portalOrigin: "http://localhost:4173",
    }));

    expect(webPanelModuleManifest.permissions).toEqual([WEB_PANEL_EMBED_PERMISSION]);
    expect(registry.listCatalog()).toMatchObject([{
      type: WEB_PANEL_CONTENT_TYPE,
      version: WEB_PANEL_RENDERER_VERSION,
      catalog: {
        defaultWidth: 16,
        defaultHeight: 14,
        requiredPermissions: [WEB_PANEL_EMBED_PERMISSION],
        permissions: [{ id: WEB_PANEL_EMBED_PERMISSION }],
        fields: [
          { key: "url", input: "url", required: true },
          { key: "allowedOrigins", input: "textarea", required: true },
        ],
      },
    }]);
  });

  it("matches only normalized, explicitly listed HTTP origins", () => {
    expect(parseAllowedOrigins("https://example.com/\nhttps://example.com\nhttp://localhost:8123"))
      .toEqual(["https://example.com", "http://localhost:8123"]);
    expect(parseAllowedOrigins("https://example.com/path")).toBeNull();
    expect(parseAllowedOrigins("https://user:password@example.com")).toBeNull();
    expect(parseAllowedOrigins("javascript:alert(1)")).toBeNull();

    expect(resolveWebPanelTarget({
      url: "https://example.com/dashboard?room=bedroom",
      allowedOrigins: "https://example.com",
    }, "https://synaius.example")).toMatchObject({
      status: "ready",
      origin: "https://example.com",
      host: "example.com",
    });
    expect(resolveWebPanelTarget({
      url: "https://sub.example.com/dashboard",
      allowedOrigins: "https://example.com",
    })).toEqual({ status: "origin-not-allowed", origin: "https://sub.example.com" });
    expect(resolveWebPanelTarget({
      url: "http://localhost:4173/internal",
      allowedOrigins: "http://localhost:4173",
    }, "http://localhost:4173")).toEqual({
      status: "portal-origin-blocked",
      origin: "http://localhost:4173",
    });
    expect(resolveWebPanelTarget({
      url: "file:///C:/private.txt",
      allowedOrigins: "http://localhost:4173",
    })).toEqual({ status: "invalid" });
  });

  it("renders a listed external origin only in the restricted iframe profile", () => {
    const renderer = createWebPanelRenderer({
      localeMessages: hu,
      portalOrigin: "http://localhost:4173",
    });
    const instance = {
      id: "content:web-panel",
      type: WEB_PANEL_CONTENT_TYPE,
      rendererVersion: WEB_PANEL_RENDERER_VERSION,
      revision: 0,
      configuration: {
        url: "https://example.com/dashboard",
        allowedOrigins: "https://example.com",
      },
      requiredPermissions: [WEB_PANEL_EMBED_PERMISSION],
      sourceNodeId: null,
    };
    const rendered = renderer.render(instance, {} as WorkspaceContentRenderContext);
    expect(isValidElement(rendered)).toBe(true);
    const iframe = findElement(rendered, "iframe");
    const externalLink = findElement(rendered, "a");
    expect(iframe).toBeDefined();
    expect(iframe?.props).toMatchObject({
      allow: "",
      "data-security-profile": "external-sandbox",
      loading: "lazy",
      referrerPolicy: "no-referrer",
      sandbox: WEB_PANEL_SANDBOX,
      src: "https://example.com/dashboard",
    });
    expect(externalLink?.props).toMatchObject({
      href: "https://example.com/dashboard",
      rel: "noopener noreferrer",
      target: "_blank",
    });
  });

  it("fails closed without creating an iframe for a policy-blocked target", () => {
    const renderer = createWebPanelRenderer({
      localeMessages: hu,
      portalOrigin: "https://synaius.example",
    });
    const rendered = renderer.render({
      id: "content:web-panel-blocked",
      type: WEB_PANEL_CONTENT_TYPE,
      rendererVersion: WEB_PANEL_RENDERER_VERSION,
      revision: 0,
      configuration: {
        url: "https://blocked.example/dashboard",
        allowedOrigins: "https://allowed.example",
      },
      requiredPermissions: [WEB_PANEL_EMBED_PERMISSION],
      sourceNodeId: null,
    }, {} as WorkspaceContentRenderContext);

    expect(isValidElement(rendered)).toBe(true);
    expect((rendered as ReactElement<Record<string, unknown>>).props["data-policy-status"])
      .toBe("origin-not-allowed");
    expect(findElement(rendered, "iframe")).toBeUndefined();
  });
});

function findElement(node: ReactNode, type: string): ReactElement<Record<string, unknown>> | undefined {
  if (!isValidElement(node)) return undefined;
  if (node.type === type) return node as ReactElement<Record<string, unknown>>;
  for (const child of Children.toArray((node.props as { children?: ReactNode }).children)) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return undefined;
}
