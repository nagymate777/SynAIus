import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspace, type WorkspaceCommand } from "@synaius/domain";
import {
  ARTIFACT_VIEWER_CONTENT_TYPE,
  openThreadFileArtifact,
} from "@synaius/module-artifact-viewer";
import {
  ArtifactGatewayError,
  BrowserArtifactGateway,
} from "@synaius/module-artifact-viewer/client";
import { artifactRootForThread, readArtifactFile } from "@synaius/module-thread-stream/server";
import type { WorkspaceContentRenderContext } from "@synaius/workspace-ui";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("artifact viewer", () => {
  it("reads bounded text, Markdown and raster image files inside the thread root", async () => {
    const root = temporaryRoot();
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "plain.txt"), "árvíztűrő tükörfúrógép", "utf8");
    writeFileSync(join(root, "docs", "guide.md"), "# Cím\n\nTartalom", "utf8");
    writeFileSync(join(root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await expect(readArtifactFile("thread-1", root, "plain.txt")).resolves.toMatchObject({
      path: "plain.txt",
      kind: "text",
      encoding: "utf8",
      content: "árvíztűrő tükörfúrógép",
    });
    await expect(readArtifactFile("thread-1", root, "docs/guide.md")).resolves.toMatchObject({
      path: "docs/guide.md",
      kind: "markdown",
      mimeType: "text/markdown",
    });
    await expect(readArtifactFile("thread-1", root, "image.png")).resolves.toMatchObject({
      kind: "image",
      encoding: "base64",
      content: "iVBORw==",
    });
  });

  it("rejects root escapes, secret-like files and unsupported binaries", async () => {
    const parent = temporaryRoot();
    const root = join(parent, "workspace");
    mkdirSync(root);
    writeFileSync(join(parent, "outside.txt"), "outside", "utf8");
    writeFileSync(join(root, ".env"), "TOKEN=hidden", "utf8");
    writeFileSync(join(root, "credentials.json"), "{}", "utf8");
    writeFileSync(join(root, "archive.bin"), Buffer.from([0, 1, 2]));

    await expect(readArtifactFile("thread-1", root, "../outside.txt"))
      .rejects.toMatchObject({ message: "artifact.path.denied", statusCode: 403 });
    await expect(readArtifactFile("thread-1", root, ".env"))
      .rejects.toMatchObject({ message: "artifact.path.denied", statusCode: 403 });
    await expect(readArtifactFile("thread-1", root, "credentials.json"))
      .rejects.toMatchObject({ message: "artifact.path.denied", statusCode: 403 });
    await expect(readArtifactFile("thread-1", root, "archive.bin"))
      .rejects.toMatchObject({ message: "artifact.file.unsupported", statusCode: 415 });
  });

  it("authorizes an absolute path outside the initial cwd only when a file-change item names it", () => {
    const parent = temporaryRoot();
    const cwd = join(parent, "initial");
    const project = join(parent, "project");
    const changed = join(project, "src", "app.ts");
    mkdirSync(cwd);
    mkdirSync(join(project, "src"), { recursive: true });
    const raw = {
      cwd,
      turns: [{
        items: [{
          type: "fileChange",
          changes: [{ path: changed, kind: "update", diff: "+new" }],
        }],
      }],
    };

    expect(artifactRootForThread(raw, changed)).toBe(dirname(changed));
    expect(() => artifactRootForThread(raw, join(project, "src", "secret.ts")))
      .toThrowError(expect.objectContaining({ message: "artifact.path.denied", statusCode: 403 }));
  });

  it("uses the scoped bridge endpoint and preserves server error codes", async () => {
    const requests: string[] = [];
    const gateway = new BrowserArtifactGateway({
      baseUrl: "/bridge",
      fetchImplementation: (async (url: string | URL | Request) => {
        requests.push(String(url));
        return new Response(JSON.stringify({
          provider: "thread-file",
          threadId: "thread/1",
          path: "src/app.ts",
          name: "app.ts",
          kind: "text",
          mimeType: "text/typescript",
          encoding: "utf8",
          size: 4,
          modifiedAt: "2026-08-09T10:00:00.000Z",
          content: "test",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch,
    });

    await expect(gateway.readThreadFile("thread/1", "src/app.ts"))
      .resolves.toMatchObject({ name: "app.ts", content: "test" });
    expect(requests[0]).toBe("/bridge/threads/thread%2F1/artifacts/file?path=src%2Fapp.ts");

    const failingGateway = new BrowserArtifactGateway({
      fetchImplementation: (async () => new Response(
        JSON.stringify({ error: "artifact.path.denied" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch,
    });
    await expect(failingGateway.readThreadFile("thread-1", ".env"))
      .rejects.toEqual(new ArtifactGatewayError("artifact.path.denied"));
  });

  it("opens a file through the versioned workspace command layer", () => {
    const workspace = createWorkspace({
      workspaceId: "artifact-test",
      initialViewId: "main",
      initialViewName: "Teszt",
    });
    const box = Object.values(workspace.boxes).find((candidate) => candidate.role.type === "device")!;
    const commands: Array<{ type: WorkspaceCommand["type"]; payload: unknown }> = [];
    const context: WorkspaceContentRenderContext = {
      box,
      workspace,
      execute(type, payload) {
        commands.push({ type, payload });
      },
    };

    openThreadFileArtifact(context, {
      threadId: "thread-1",
      path: "src/app.ts",
      boxName: "app.ts",
    });

    expect(commands.map((command) => command.type)).toEqual(["content.box.create"]);
    expect(commands[0]!.payload).toMatchObject({
      content: {
        type: ARTIFACT_VIEWER_CONTENT_TYPE,
        configuration: { provider: "thread-file", threadId: "thread-1", path: "src/app.ts" },
      },
    });
  });
});

function temporaryRoot() {
  const directory = mkdtempSync(join(tmpdir(), "synaius-artifact-"));
  temporaryDirectories.push(directory);
  return directory;
}
