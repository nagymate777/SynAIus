import type {
  DurableThreadEvent,
  StreamCursor,
  ThreadAttachment,
  ThreadPage,
  ThreadSnapshot,
  ThreadStreamGateway,
} from "@synaius/protocol";

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export interface BrowserThreadStreamGatewayOptions {
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
  eventSourceFactory?: (url: string) => EventSourceLike;
}

export class BrowserThreadStreamGateway implements ThreadStreamGateway {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly eventSourceFactory: (url: string) => EventSourceLike;

  constructor(options: BrowserThreadStreamGatewayOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "/api/thread-stream").replace(/\/$/, "");
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.eventSourceFactory = options.eventSourceFactory
      ?? ((url) => new EventSource(url) as unknown as EventSourceLike);
  }

  listThreads(cursor: string | null = null, limit = 50): Promise<ThreadPage> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    return this.readJson<ThreadPage>(`${this.baseUrl}/threads?${query}`);
  }

  readThread(threadId: string): Promise<ThreadSnapshot> {
    return this.readJson<ThreadSnapshot>(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}`);
  }

  async resumeThread(threadId: string): Promise<ThreadSnapshot> {
    return this.readJson<ThreadSnapshot>(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}/resume`, {
      method: "POST",
    });
  }

  async attachThread(threadId: string, after?: StreamCursor): Promise<ThreadAttachment> {
    const snapshot = await this.readJson<ThreadSnapshot>(
      `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/attach`,
      { method: "POST" },
    );
    const query = new URLSearchParams();
    const resumeCursor = after ?? snapshot.cursor;
    if (resumeCursor) query.set("after", resumeCursor);
    const suffix = query.size ? `?${query}` : "";
    const source = this.eventSourceFactory(
      `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/stream${suffix}`,
    );
    const queue = new AsyncEventQueue<DurableThreadEvent>();
    source.addEventListener("thread-event", (event) => {
      try {
        queue.push(JSON.parse(event.data) as DurableThreadEvent);
      } catch (error) {
        queue.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return {
      snapshot,
      events: queue,
      async detach() {
        source.close();
        queue.close();
      },
    };
  }

  async steerTurn(threadId: string, turnId: string, message: string): Promise<void> {
    await this.readJson(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId, message }),
    });
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.readJson(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}/interrupt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId }),
    });
  }

  private async readJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImplementation(url, init);
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body?.error || `thread-stream.http.${response.status}`);
    return body;
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  private ended = false;
  private error: Error | null = null;

  [Symbol.asyncIterator]() {
    return this;
  }

  next(): Promise<IteratorResult<T>> {
    if (this.values.length) return Promise.resolve({ value: this.values.shift()!, done: false });
    if (this.error) return Promise.reject(this.error);
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  push(value: T) {
    if (this.ended || this.error) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  fail(error: Error) {
    if (this.ended || this.error) return;
    this.error = error;
    this.waiters.splice(0).forEach((waiter) => waiter.reject(error));
  }

  close() {
    if (this.ended) return;
    this.ended = true;
    this.waiters.splice(0).forEach((waiter) => waiter.resolve({ value: undefined, done: true }));
  }
}
