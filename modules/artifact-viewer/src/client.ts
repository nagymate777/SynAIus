import type { ArtifactDocument, ArtifactFileIndex, ArtifactGateway } from "@synaius/protocol";

export interface BrowserArtifactGatewayOptions {
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
}

export class ArtifactGatewayError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export class BrowserArtifactGateway implements ArtifactGateway {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: BrowserArtifactGatewayOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "/api/thread-stream").replace(/\/$/, "");
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
  }

  async listThreadFiles(threadId: string): Promise<ArtifactFileIndex> {
    const response = await this.fetchImplementation(
      `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/artifacts`,
    );
    const body = await response.json() as ArtifactFileIndex & { error?: string };
    if (!response.ok) throw new ArtifactGatewayError(body.error ?? `artifact.http.${response.status}`);
    return body;
  }

  async readThreadFile(threadId: string, path: string): Promise<ArtifactDocument> {
    const query = new URLSearchParams({ path });
    const response = await this.fetchImplementation(
      `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/artifacts/file?${query}`,
    );
    const body = await response.json() as ArtifactDocument & { error?: string };
    if (!response.ok) throw new ArtifactGatewayError(body.error ?? `artifact.http.${response.status}`);
    return body;
  }
}
