import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ArtifactDocument, ArtifactDocumentKind } from "@synaius/protocol";

const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const TEXT_MIME_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".jsonc": "application/json",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".css": "text/css",
  ".scss": "text/x-scss",
  ".less": "text/x-less",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".sh": "text/x-shellscript",
  ".ps1": "text/x-powershell",
  ".py": "text/x-python",
  ".java": "text/x-java-source",
  ".c": "text/x-c",
  ".h": "text/x-c",
  ".cpp": "text/x-c++",
  ".hpp": "text/x-c++",
  ".cs": "text/x-csharp",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".sql": "application/sql",
};
const DENIED_SEGMENTS = new Set([".git", ".codex", ".ssh", ".gnupg"]);
const DENIED_FILE_NAMES = new Set([
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".netrc",
  "credentials.json",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "id_rsa",
  "id_ed25519",
]);
const DENIED_EXTENSIONS = new Set([".pem", ".key", ".pfx", ".p12"]);

export async function readArtifactFile(
  threadId: string,
  root: string,
  requestedPath: string,
): Promise<ArtifactDocument> {
  const normalizedRoot = root.trim();
  const normalizedRequest = requestedPath.trim();
  if (!normalizedRoot) throw artifactError("artifact.root.unavailable", 409);
  if (!normalizedRequest || normalizedRequest.includes("\0")) {
    throw artifactError("artifact.path.invalid", 400);
  }

  let realRoot: string;
  try {
    realRoot = await realpath(normalizedRoot);
  } catch {
    throw artifactError("artifact.root.unavailable", 409);
  }
  const candidate = isAbsolute(normalizedRequest)
    ? resolve(normalizedRequest)
    : resolve(realRoot, normalizedRequest);
  assertWithinRoot(realRoot, candidate);

  let realCandidate: string;
  try {
    realCandidate = await realpath(candidate);
  } catch {
    throw artifactError("artifact.file.notFound", 404);
  }
  const relativePath = assertWithinRoot(realRoot, realCandidate);
  assertAllowedPath(relativePath);

  const fileStat = await stat(realCandidate);
  if (!fileStat.isFile()) throw artifactError("artifact.file.notRegular", 415);
  if (fileStat.size > MAX_ARTIFACT_BYTES) throw artifactError("artifact.file.tooLarge", 413);

  const extension = extname(realCandidate).toLocaleLowerCase();
  const kind: ArtifactDocumentKind = MARKDOWN_EXTENSIONS.has(extension)
    ? "markdown"
    : IMAGE_MIME_TYPES[extension]
      ? "image"
      : TEXT_MIME_TYPES[extension]
        ? "text"
        : (() => { throw artifactError("artifact.file.unsupported", 415); })();
  const mimeType = kind === "markdown"
    ? "text/markdown"
    : IMAGE_MIME_TYPES[extension] ?? TEXT_MIME_TYPES[extension]!;
  const buffer = await readFile(realCandidate);
  let content: string;
  if (kind === "image") {
    content = buffer.toString("base64");
  } else {
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw artifactError("artifact.file.unsupported", 415);
    }
    if (content.includes("\0")) throw artifactError("artifact.file.unsupported", 415);
  }

  return {
    provider: "thread-file",
    threadId,
    path: relativePath.split(sep).join("/"),
    name: basename(realCandidate),
    kind,
    mimeType,
    encoding: kind === "image" ? "base64" : "utf8",
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    content,
  };
}

export function artifactRootForThread(rawThread: unknown, requestedPath: string) {
  const thread = asRecord(rawThread);
  const cwd = stringValue(thread.cwd)?.trim();
  if (!cwd) throw artifactError("artifact.root.unavailable", 409);
  if (!isAbsolute(requestedPath)) return cwd;

  const requestedAbsolute = resolve(requestedPath);
  if (isPathInside(cwd, requestedAbsolute)) return cwd;
  const authorizedPaths = (Array.isArray(thread.turns) ? thread.turns : [])
    .flatMap((turn) => {
      const turnRecord = asRecord(turn);
      const items = Array.isArray(turnRecord.items) ? turnRecord.items as unknown[] : [];
      return items.flatMap((item) => {
        const record = asRecord(item);
        if (record.type !== "fileChange" || !Array.isArray(record.changes)) return [];
        return record.changes.flatMap((change) => {
          const changedPath = stringValue(asRecord(change).path);
          if (!changedPath) return [];
          return [isAbsolute(changedPath) ? resolve(changedPath) : resolve(cwd, changedPath)];
        });
      });
    });
  if (!authorizedPaths.some((path) => samePath(path, requestedAbsolute))) {
    throw artifactError("artifact.path.denied", 403);
  }
  return dirname(requestedAbsolute);
}

function assertWithinRoot(root: string, candidate: string) {
  const pathFromRoot = relative(root, candidate);
  if (!pathFromRoot || pathFromRoot === ".") throw artifactError("artifact.file.notRegular", 415);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw artifactError("artifact.path.denied", 403);
  }
  return pathFromRoot;
}

function isPathInside(root: string, candidate: string) {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return Boolean(pathFromRoot)
    && pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot);
}

function samePath(left: string, right: string) {
  return process.platform === "win32"
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
}

function assertAllowedPath(pathFromRoot: string) {
  const segments = pathFromRoot.split(/[\\/]/).map((segment) => segment.toLocaleLowerCase());
  const name = segments.at(-1) ?? "";
  const extension = extname(name);
  if (segments.some((segment) => DENIED_SEGMENTS.has(segment))
    || DENIED_FILE_NAMES.has(name)
    || name === ".env"
    || name.startsWith(".env.")
    || DENIED_EXTENSIONS.has(extension)) {
    throw artifactError("artifact.path.denied", 403);
  }
}

function artifactError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}
