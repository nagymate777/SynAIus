export type ArtifactDocumentKind = "text" | "markdown" | "image";
export type ArtifactDocumentEncoding = "utf8" | "base64";
export type ArtifactFileChangeKind = "add" | "update" | "delete" | "unknown";

export interface ArtifactFileEntry {
  path: string;
  name: string;
  changeKind: ArtifactFileChangeKind;
  diff: string;
  occurrences: number;
  turnId: string | null;
  itemId: string | null;
}

export interface ArtifactFileIndex {
  provider: "thread-file";
  threadId: string;
  files: ArtifactFileEntry[];
}

export interface ArtifactDocument {
  provider: "thread-file";
  threadId: string;
  path: string;
  name: string;
  kind: ArtifactDocumentKind;
  mimeType: string;
  encoding: ArtifactDocumentEncoding;
  size: number;
  modifiedAt: string;
  content: string;
}

export interface ArtifactGateway {
  listThreadFiles(threadId: string): Promise<ArtifactFileIndex>;
  readThreadFile(threadId: string, path: string): Promise<ArtifactDocument>;
}
