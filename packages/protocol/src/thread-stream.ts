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

export type ServerRequestId = string | number;

export interface InteractionOption {
  label: string;
  description: string;
}

export interface InteractionQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: InteractionOption[] | null;
}

interface PendingInteractionBase {
  requestId: ServerRequestId;
  threadId: string;
  turnId: string | null;
  itemId: string | null;
  createdAt: string;
}

export type PendingThreadInteraction = PendingInteractionBase & (
  | {
      kind: "commandApproval";
      reason: string | null;
      command: string | null;
      cwd: string | null;
      networkHost: string | null;
      networkProtocol: string | null;
    }
  | {
      kind: "fileApproval";
      reason: string | null;
      grantRoot: string | null;
    }
  | {
      kind: "userInput";
      questions: InteractionQuestion[];
      isBlocking: boolean;
    }
  | {
      kind: "permissionsApproval";
      reason: string | null;
      cwd: string | null;
      requestedPermissions: unknown;
    }
  | {
      kind: "mcpElicitation";
      serverName: string;
      mode: "form" | "openai/form" | "url";
      message: string;
      url: string | null;
    }
);

export type ThreadInteractionResponse =
  | {
      kind: "approval";
      decision: "accept" | "acceptForSession" | "decline" | "cancel";
    }
  | {
      kind: "userInput";
      answers: Record<string, string[]>;
    }
  | {
      kind: "permissions";
      decision: "grantTurn" | "grantSession" | "decline";
    }
  | {
      kind: "mcpElicitation";
      action: "decline" | "cancel";
    };

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
  listInteractions(threadId: string): Promise<PendingThreadInteraction[]>;
  respondToInteraction(
    threadId: string,
    requestId: ServerRequestId,
    response: ThreadInteractionResponse,
  ): Promise<void>;
  readThread(threadId: string): Promise<ThreadSnapshot>;
  attachThread(threadId: string, after?: StreamCursor): Promise<ThreadAttachment>;
  resumeThread(threadId: string): Promise<ThreadSnapshot>;
  startTurn(threadId: string, message: string): Promise<void>;
  steerTurn(threadId: string, turnId: string, message: string): Promise<void>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
}
