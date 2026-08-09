export type ArtifactDocumentKind = "text" | "markdown" | "image";
export type ArtifactDocumentEncoding = "utf8" | "base64";

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
  readThreadFile(threadId: string, path: string): Promise<ArtifactDocument>;
}
