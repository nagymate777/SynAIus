import type { SynAIusModuleManifest } from "@synaius/application";

export const THREAD_STREAM_CONTENT_TYPE = "module.thread-stream.viewer";
export const THREAD_STREAM_RENDERER_VERSION = 1;

export const threadStreamModuleManifest: SynAIusModuleManifest = {
  id: "thread-stream",
  version: "0.1.0",
  localeNamespace: "module.thread-stream",
  contentTypes: [THREAD_STREAM_CONTENT_TYPE],
  permissions: ["codex.thread.read", "codex.thread.steer", "codex.turn.interrupt"],
};
