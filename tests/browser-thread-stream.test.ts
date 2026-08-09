import { describe, expect, it } from "vitest";
import { BrowserThreadStreamGateway, type EventSourceLike } from "@synaius/module-thread-stream/client";
import type { DurableThreadEvent, ThreadSnapshot } from "@synaius/protocol";

describe("browser thread-stream gateway", () => {
  it("attaches from the durable snapshot cursor and closes its event stream", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const source = new FakeEventSource();
    const snapshot: ThreadSnapshot = {
      threadId: "thread/1",
      cursor: "12",
      activeTurnId: null,
      name: null,
      status: "idle",
      accessMode: "interactive",
      raw: {},
    };
    const gateway = new BrowserThreadStreamGateway({
      baseUrl: "/bridge",
      fetchImplementation: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
      eventSourceFactory: (url) => {
        source.url = url;
        return source;
      },
    });

    const attachment = await gateway.attachThread("thread/1");
    expect(requests[0].url).toBe("/bridge/threads/thread%2F1/attach");
    expect(requests[0].init?.method).toBe("POST");
    expect(source.url).toBe("/bridge/threads/thread%2F1/stream?after=12");

    const event: DurableThreadEvent = {
      cursor: "13",
      threadId: "thread/1",
      turnId: null,
      method: "gateway/connected",
      source: "gateway",
      connectionId: "connection-1",
      receivedAt: "2026-08-09T10:00:00.000Z",
      raw: { method: "gateway/connected", params: {} },
    };
    const nextEvent = attachment.events[Symbol.asyncIterator]().next();
    source.dispatch("thread-event", JSON.stringify(event));
    expect(await nextEvent).toEqual({ value: event, done: false });
    await attachment.detach();
    expect(source.closed).toBe(true);
  });

  it("binds the native fetch implementation to its global owner", async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown = null;
    globalThis.fetch = (async function (this: unknown) {
      receiver = this;
      return new Response(JSON.stringify({ threads: [], nextCursor: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const gateway = new BrowserThreadStreamGateway();
      await gateway.listThreads();
      expect(receiver).toBe(globalThis);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

class FakeEventSource implements EventSourceLike {
  url = "";
  closed = false;
  private readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, listener);
  }

  close() {
    this.closed = true;
  }

  dispatch(type: string, data: string) {
    this.listeners.get(type)?.({ data } as MessageEvent<string>);
  }
}
