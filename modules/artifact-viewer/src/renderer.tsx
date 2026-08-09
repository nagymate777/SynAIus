import { useEffect, useState, type ReactNode } from "react";
import type { ContentInstance, ContentRendererDefinition, JsonObject } from "@synaius/content";
import { createTranslator, type TranslationDictionary } from "@synaius/i18n";
import type { ArtifactDocument, ArtifactFileEntry, ArtifactGateway } from "@synaius/protocol";
import type { WorkspaceContentRenderContext } from "@synaius/workspace-ui";
import {
  ARTIFACT_VIEWER_CONTENT_TYPE,
  ARTIFACT_VIEWER_RENDERER_VERSION,
} from "./index.ts";
import "./artifact-viewer.css";

export interface ArtifactViewerRendererOptions {
  gateway: ArtifactGateway;
  localeMessages: TranslationDictionary;
}

export function createArtifactViewerRenderer(
  options: ArtifactViewerRendererOptions,
): ContentRendererDefinition<ReactNode, WorkspaceContentRenderContext> {
  const t = createTranslator(options.localeMessages);
  return {
    type: ARTIFACT_VIEWER_CONTENT_TYPE,
    moduleId: "artifact-viewer",
    version: ARTIFACT_VIEWER_RENDERER_VERSION,
    titleKey: "module.artifact-viewer.title",
    validateConfiguration: isArtifactViewerConfiguration,
    render: (instance) => <ArtifactViewer content={instance} gateway={options.gateway} t={t} />,
  };
}

function ArtifactViewer({
  content,
  gateway,
  t,
}: {
  content: ContentInstance;
  gateway: ArtifactGateway;
  t: ReturnType<typeof createTranslator>;
}) {
  const configuration = readConfiguration(content.configuration);
  const [document, setDocument] = useState<ArtifactDocument | null>(null);
  const [fileEntry, setFileEntry] = useState<ArtifactFileEntry | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [viewMode, setViewMode] = useState<"current" | "diff">("current");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorKey(null);
    Promise.allSettled([
      gateway.readThreadFile(configuration.threadId, configuration.path),
      gateway.listThreadFiles(configuration.threadId),
    ]).then(([documentResult, indexResult]) => {
      if (cancelled) return;
      const nextDocument = documentResult.status === "fulfilled" ? documentResult.value : null;
      const nextEntry = indexResult.status === "fulfilled"
        ? indexResult.value.files.find((file) => sameArtifactPath(file.path, configuration.path)) ?? null
        : null;
      setDocument(nextDocument);
      setFileEntry(nextEntry);
      setErrorKey(nextDocument ? null : artifactErrorKey(
        documentResult.status === "rejected" && documentResult.reason instanceof Error
          ? documentResult.reason.message
          : "",
      ));
      setViewMode(nextDocument ? "current" : nextEntry?.diff ? "diff" : "current");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [configuration.path, configuration.threadId, gateway, reload]);

  return (
    <section className="artifact-viewer">
      <header className="artifact-viewer-header">
        <div>
          <strong>{document?.name ?? fileEntry?.name ?? configuration.path}</strong>
          <code>{document?.path ?? fileEntry?.path ?? configuration.path}</code>
        </div>
        <div className="artifact-viewer-actions">
          <div aria-label={t("module.artifact-viewer.view.label")} role="group">
            <button
              aria-pressed={viewMode === "current"}
              disabled={!document}
              onClick={() => setViewMode("current")}
              type="button"
            >
              {t("module.artifact-viewer.view.current")}
            </button>
            <button
              aria-pressed={viewMode === "diff"}
              disabled={!fileEntry?.diff}
              onClick={() => setViewMode("diff")}
              type="button"
            >
              {t("module.artifact-viewer.view.diff")}
            </button>
          </div>
          <button disabled={loading} onClick={() => setReload((value) => value + 1)} type="button">
            {t("module.artifact-viewer.action.reload")}
          </button>
        </div>
      </header>
      <div className="artifact-viewer-meta">
        {document && (
          <>
            <span>{t(artifactKindKey(document.kind))}</span>
            <span>{t("module.artifact-viewer.size", { size: formatSize(document.size, t) })}</span>
          </>
        )}
        {fileEntry && (
          <>
            <span>{t(artifactChangeKindKey(fileEntry.changeKind))}</span>
            <span>{t("module.artifact-viewer.changeCount", { count: fileEntry.occurrences })}</span>
          </>
        )}
      </div>
      <div className="artifact-viewer-body">
        {loading && <p>{t("module.artifact-viewer.loading")}</p>}
        {!loading && viewMode === "current" && errorKey && <p role="alert">{t(errorKey)}</p>}
        {!loading && viewMode === "current" && document?.kind === "text" && (
          <LineNumberedCode value={document.content} />
        )}
        {!loading && viewMode === "current" && document?.kind === "markdown" && (
          <MarkdownDocument value={document.content} />
        )}
        {!loading && viewMode === "current" && document?.kind === "image" && (
          <img
            alt={document.name}
            src={`data:${document.mimeType};base64,${document.content}`}
          />
        )}
        {!loading && viewMode === "diff" && fileEntry?.diff && (
          <LineNumberedCode diff value={fileEntry.diff} />
        )}
      </div>
    </section>
  );
}

function LineNumberedCode({ value, diff = false }: { value: string; diff?: boolean }) {
  const lines = value.split(/\r?\n/);
  return (
    <div className="artifact-viewer-code" data-diff={diff}>
      {lines.map((line, index) => (
        <div data-kind={diff ? diffLineKind(line) : undefined} key={`${index}:${line}`}>
          <span aria-hidden="true">{index + 1}</span>
          <code>{line || "\u00a0"}</code>
        </div>
      ))}
    </div>
  );
}

function MarkdownDocument({ value }: { value: string }) {
  const lines = value.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) {
        code.push(lines[index]!);
        index += 1;
      }
      index += 1;
      nodes.push(<pre key={`code:${index}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const key = `heading:${index}`;
      const text = heading[2];
      nodes.push(heading[1].length === 1
        ? <h1 key={key}>{text}</h1>
        : heading[1].length === 2
          ? <h2 key={key}>{text}</h2>
          : <h3 key={key}>{text}</h3>);
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index]!)) {
        items.push(lines[index]!.replace(/^[-*]\s+/, ""));
        index += 1;
      }
      nodes.push(<ul key={`list:${index}`}>{items.map((item, itemIndex) => (
        <li key={`${itemIndex}:${item}`}>{item}</li>
      ))}</ul>);
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim()
      && !/^(#{1,3})\s+|^```|^[-*]\s+/.test(lines[index]!)) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    nodes.push(<p key={`paragraph:${index}`}>{paragraph.join(" ")}</p>);
  }
  return <article className="artifact-viewer-markdown">{nodes}</article>;
}

function readConfiguration(configuration: JsonObject) {
  return {
    threadId: String(configuration.threadId),
    path: String(configuration.path),
  };
}

function isArtifactViewerConfiguration(configuration: JsonObject) {
  return configuration.provider === "thread-file"
    && typeof configuration.threadId === "string"
    && Boolean(configuration.threadId.trim())
    && typeof configuration.path === "string"
    && Boolean(configuration.path.trim());
}

function artifactKindKey(kind: ArtifactDocument["kind"]) {
  const keys: Record<ArtifactDocument["kind"], string> = {
    text: "module.artifact-viewer.kind.text",
    markdown: "module.artifact-viewer.kind.markdown",
    image: "module.artifact-viewer.kind.image",
  };
  return keys[kind];
}

function artifactChangeKindKey(kind: ArtifactFileEntry["changeKind"]) {
  const keys: Record<ArtifactFileEntry["changeKind"], string> = {
    add: "module.artifact-viewer.change.add",
    update: "module.artifact-viewer.change.update",
    delete: "module.artifact-viewer.change.delete",
    unknown: "module.artifact-viewer.change.unknown",
  };
  return keys[kind];
}

function diffLineKind(line: string) {
  if (line.startsWith("@@")) return "range";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "delete";
  return "context";
}

function sameArtifactPath(left: string, right: string) {
  const normalizedLeft = left.replaceAll("\\", "/");
  const normalizedRight = right.replaceAll("\\", "/");
  if (/^[a-z]:\//i.test(normalizedLeft) || /^[a-z]:\//i.test(normalizedRight)) {
    return normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function artifactErrorKey(code: string) {
  const keys: Record<string, string> = {
    "artifact.path.invalid": "module.artifact-viewer.error.invalid",
    "artifact.path.denied": "module.artifact-viewer.error.denied",
    "artifact.file.notFound": "module.artifact-viewer.error.notFound",
    "artifact.file.notRegular": "module.artifact-viewer.error.notRegular",
    "artifact.file.tooLarge": "module.artifact-viewer.error.tooLarge",
    "artifact.file.unsupported": "module.artifact-viewer.error.unsupported",
    "artifact.root.unavailable": "module.artifact-viewer.error.rootUnavailable",
  };
  return keys[code] ?? "module.artifact-viewer.error.generic";
}

function formatSize(size: number, t: ReturnType<typeof createTranslator>) {
  if (size < 1024) return t("module.artifact-viewer.size.bytes", { size });
  if (size < 1024 * 1024) {
    return t("module.artifact-viewer.size.kilobytes", { size: (size / 1024).toFixed(1) });
  }
  return t("module.artifact-viewer.size.megabytes", {
    size: (size / (1024 * 1024)).toFixed(1),
  });
}
