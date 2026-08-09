export type StreamCursor = string;

export interface AppServerNotification {
  method: string;
  params: unknown;
}

export type ThreadRuntimeStatus = "notLoaded" | "idle" | "active" | "systemError" | "unknown";

export interface ThreadSummary {
  threadId: string;
  name: string | null;
  preview: string;
  createdAt: number;
  updatedAt: number;
  status: ThreadRuntimeStatus;
}

export interface ThreadPage {
  threads: ThreadSummary[];
  nextCursor: string | null;
}

export interface ThreadListQuery {
  cursor?: string | null;
  limit?: number;
  searchTerm?: string | null;
}

export interface CodexReasoningEffort {
  id: string;
  description: string;
}

export interface CodexModelSummary {
  id: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: CodexReasoningEffort[];
  isDefault: boolean;
}

export interface CodexModelPage {
  models: CodexModelSummary[];
  nextCursor: string | null;
}

export interface CreateCodexThreadInput {
  model: string;
  effort?: string | null;
  cwd?: string | null;
  message: string;
}

export interface ThreadSnapshot {
  threadId: string;
  cursor: StreamCursor | null;
  activeTurnId: string | null;
  name: string | null;
  status: ThreadRuntimeStatus;
  accessMode: "interactive" | "observe";
  raw: unknown;
}

export interface DurableThreadEvent {
  cursor: StreamCursor;
  threadId: string;
  turnId: string | null;
  method: string;
  source: "app-server" | "gateway";
  connectionId: string;
  receivedAt: string;
  raw: AppServerNotification;
}

export interface ThreadAttachment {
  snapshot: ThreadSnapshot;
  events: AsyncIterable<DurableThreadEvent>;
  detach(): Promise<void>;
}

export interface ThreadStreamGateway {
  listThreads(query?: ThreadListQuery): Promise<ThreadPage>;
  listModels(cursor?: string | null, limit?: number): Promise<CodexModelPage>;
  createThread(input: CreateCodexThreadInput): Promise<ThreadSnapshot>;
  readThread(threadId: string): Promise<ThreadSnapshot>;
  attachThread(threadId: string, after?: StreamCursor): Promise<ThreadAttachment>;
  resumeThread(threadId: string): Promise<ThreadSnapshot>;
  startTurn(threadId: string, message: string): Promise<void>;
  steerTurn(threadId: string, turnId: string, message: string): Promise<void>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
}
