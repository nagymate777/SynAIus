export type StreamCursor = string;

export interface AppServerNotification {
  method: string;
  params: unknown;
}

export interface ThreadSnapshot {
  threadId: string;
  activeTurnId: string | null;
  raw: unknown;
}

export interface DurableThreadEvent {
  cursor: StreamCursor;
  threadId: string;
  turnId: string | null;
  method: string;
  raw: AppServerNotification;
}

export interface ThreadAttachment {
  snapshot: ThreadSnapshot;
  events: AsyncIterable<DurableThreadEvent>;
  detach(): Promise<void>;
}

export interface ThreadStreamGateway {
  readThread(threadId: string): Promise<ThreadSnapshot>;
  attachThread(threadId: string, after?: StreamCursor): Promise<ThreadAttachment>;
  resumeThread(threadId: string): Promise<ThreadSnapshot>;
  steerTurn(threadId: string, turnId: string, message: string): Promise<void>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
}
