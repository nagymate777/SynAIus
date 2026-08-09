import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { ContentInstance, ContentRendererDefinition, JsonObject } from "@synaius/content";
import { createTranslator, type TranslationDictionary } from "@synaius/i18n";
import type {
  DurableThreadEvent,
  ThreadRuntimeStatus,
  ThreadSnapshot,
  ThreadStreamGateway,
  ThreadSummary,
} from "@synaius/protocol";
import type { WorkspaceContentRenderContext } from "@synaius/workspace-ui";
import { THREAD_STREAM_CONTENT_TYPE, THREAD_STREAM_RENDERER_VERSION } from "./index";
import "./thread-stream.css";

export interface ThreadStreamRendererOptions {
  gateway: ThreadStreamGateway;
  localeMessages: TranslationDictionary;
}

export interface ThreadStreamLine {
  id: string;
  kind: "user" | "agent" | "activity";
  text: string;
}

export function createThreadStreamRenderer(
  options: ThreadStreamRendererOptions,
): ContentRendererDefinition<ReactNode, WorkspaceContentRenderContext> {
  const t = createTranslator(options.localeMessages);
  return {
    type: THREAD_STREAM_CONTENT_TYPE,
    moduleId: "thread-stream",
    version: THREAD_STREAM_RENDERER_VERSION,
    titleKey: "module.thread-stream.title",
    validateConfiguration: isThreadStreamConfiguration,
    render: (instance, context) => (
      <ThreadStreamPanel
        content={instance}
        context={context}
        gateway={options.gateway}
        t={t}
      />
    ),
  };
}

function ThreadStreamPanel({
  content,
  context,
  gateway,
  t,
}: {
  content: ContentInstance;
  context: WorkspaceContentRenderContext;
  gateway: ThreadStreamGateway;
  t: ReturnType<typeof createTranslator>;
}) {
  const configuredThreadId = threadIdFrom(content.configuration);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null);
  const [lines, setLines] = useState<ThreadStreamLine[]>([]);
  const [connectionKey, setConnectionKey] = useState("module.thread-stream.connection.connecting");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    setErrorKey(null);
    gateway.listThreads(null, 100)
      .then((page) => {
        if (!cancelled) setThreads(page.threads);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("thread-stream.list.failed", error);
          setErrorKey("module.thread-stream.error.list");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => Promise<void>) | null = null;
    setSnapshot(null);
    setLines([]);
    if (!configuredThreadId) {
      setConnectionKey("module.thread-stream.connection.notSelected");
      return () => undefined;
    }
    setConnectionKey("module.thread-stream.connection.connecting");
    setErrorKey(null);
    void gateway.attachThread(configuredThreadId).then(async (attachment) => {
      if (cancelled) {
        await attachment.detach();
        return;
      }
      detach = attachment.detach;
      setSnapshot(attachment.snapshot);
      setLines(projectThreadSnapshot(attachment.snapshot));
      setConnectionKey(attachment.snapshot.accessMode === "observe"
        ? "module.thread-stream.connection.observe"
        : "module.thread-stream.connection.live");
      for await (const event of attachment.events) {
        if (cancelled) break;
        if (event.method === "gateway/snapshotChanged") {
          const refreshed = await gateway.readThread(configuredThreadId);
          if (cancelled) break;
          setSnapshot(refreshed);
          setLines(projectThreadSnapshot(refreshed));
          setConnectionKey("module.thread-stream.connection.observe");
          continue;
        }
        setLines((current) => projectThreadEvent(current, event));
        setSnapshot((current) => updateSnapshotStatus(current, event));
        if (event.method === "gateway/disconnected"
          || event.method === "gateway/reconnectScheduled") {
          setConnectionKey("module.thread-stream.connection.reconnecting");
        } else if (event.method === "gateway/reconnected"
          || event.method === "gateway/connected") {
          setConnectionKey("module.thread-stream.connection.live");
        }
      }
    }).catch(() => {
      if (!cancelled) {
        setConnectionKey("module.thread-stream.connection.error");
        setErrorKey("module.thread-stream.error.attach");
      }
    });
    return () => {
      cancelled = true;
      if (detach) void detach();
    };
  }, [configuredThreadId, gateway]);

  const selectedLabel = useMemo(() => {
    const selected = threads.find((thread) => thread.threadId === configuredThreadId);
    return selected ? threadLabel(selected) : configuredThreadId;
  }, [configuredThreadId, threads]);

  function selectThread(threadId: string) {
    context.execute("content.configure", {
      contentId: content.id,
      configuration: { ...content.configuration, threadId: threadId || null },
    });
  }

  function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!configuredThreadId || !snapshot?.activeTurnId || !draft.trim()) return;
    if (snapshot.accessMode === "observe") return;
    const message = draft.trim();
    setDraft("");
    void gateway.steerTurn(configuredThreadId, snapshot.activeTurnId, message).catch(() => {
      setErrorKey("module.thread-stream.error.steer");
    });
  }

  function interrupt() {
    if (!configuredThreadId || !snapshot?.activeTurnId) return;
    void gateway.interruptTurn(configuredThreadId, snapshot.activeTurnId).catch(() => {
      setErrorKey("module.thread-stream.error.interrupt");
    });
  }

  return (
    <section
      className="thread-stream-panel"
      data-box-names-visible={context.workspace.preferences.namesVisible}
    >
      <header className="thread-stream-toolbar">
        <select
          aria-label={t("module.thread-stream.thread.select")}
          onChange={(event) => selectThread(event.target.value)}
          value={configuredThreadId ?? ""}
        >
          <option value="">{t("module.thread-stream.thread.none")}</option>
          {threads.map((thread) => (
            <option key={thread.threadId} value={thread.threadId}>{threadLabel(thread)}</option>
          ))}
        </select>
        <span className="thread-stream-connection" data-status={snapshot?.status ?? "unknown"}>
          {t(connectionKey)}
        </span>
      </header>
      {selectedLabel && <div className="thread-stream-title">{selectedLabel}</div>}
      <div className="thread-stream-log" aria-live="polite">
        {!configuredThreadId && (
          <p className="thread-stream-empty">{t("module.thread-stream.thread.choose")}</p>
        )}
        {configuredThreadId && lines.length === 0 && !errorKey && (
          <p className="thread-stream-empty">{t("module.thread-stream.thread.waiting")}</p>
        )}
        {lines.map((line) => (
          <article className="thread-stream-line" data-kind={line.kind} key={line.id}>
            {line.text}
          </article>
        ))}
      </div>
      {errorKey && <div className="thread-stream-error" role="alert">{t(errorKey)}</div>}
      <form className="thread-stream-compose" onSubmit={submitMessage}>
        <input
          aria-label={t("module.thread-stream.message.label")}
        disabled={!snapshot?.activeTurnId || snapshot.accessMode === "observe"}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("module.thread-stream.message.placeholder")}
          value={draft}
        />
        <button disabled={!snapshot?.activeTurnId || snapshot.accessMode === "observe" || !draft.trim()} type="submit">
          {t("module.thread-stream.action.steer")}
        </button>
        <button disabled={!snapshot?.activeTurnId || snapshot.accessMode === "observe"} onClick={interrupt} type="button">
          {t("module.thread-stream.action.interrupt")}
        </button>
      </form>
    </section>
  );
}

export function projectThreadSnapshot(snapshot: ThreadSnapshot): ThreadStreamLine[] {
  const thread = asRecord(snapshot.raw);
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  return turns.flatMap((turn) => {
    const turnRecord = asRecord(turn);
    const items = Array.isArray(turnRecord.items) ? turnRecord.items : [];
    return items.flatMap((item) => lineFromItem(asRecord(item)));
  });
}

export function projectThreadEvent(
  current: ThreadStreamLine[],
  event: DurableThreadEvent,
): ThreadStreamLine[] {
  const params = asRecord(event.raw.params);
  if (event.method === "item/agentMessage/delta") {
    const itemId = stringValue(params.itemId) ?? `cursor:${event.cursor}`;
    const delta = stringValue(params.delta) ?? "";
    const existingIndex = current.findIndex((line) => line.id === itemId);
    if (existingIndex < 0) return [...current, { id: itemId, kind: "agent", text: delta }];
    return current.map((line, index) => index === existingIndex ? { ...line, text: `${line.text}${delta}` } : line);
  }
  if (event.method === "item/completed") {
    const lines = lineFromItem(asRecord(params.item));
    if (!lines.length) return current;
    const incoming = lines[0];
    const existingIndex = current.findIndex((line) => line.id === incoming.id);
    if (existingIndex < 0) return [...current, incoming];
    return current.map((line, index) => index === existingIndex ? incoming : line);
  }
  return current;
}

function lineFromItem(item: Record<string, unknown>): ThreadStreamLine[] {
  const id = stringValue(item.id) ?? "";
  if (!id) return [];
  if (item.type === "agentMessage") {
    const text = stringValue(item.text) ?? "";
    return text ? [{ id, kind: "agent", text }] : [];
  }
  if (item.type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const text = content
      .map((part) => stringValue(asRecord(part).text))
      .filter((part): part is string => Boolean(part))
      .join("\n");
    return text ? [{ id, kind: "user", text }] : [];
  }
  return [];
}

function updateSnapshotStatus(
  snapshot: ThreadSnapshot | null,
  event: DurableThreadEvent,
): ThreadSnapshot | null {
  if (!snapshot) return null;
  if (event.method === "turn/started") {
    return { ...snapshot, activeTurnId: event.turnId, status: "active" };
  }
  if (event.method === "turn/completed") {
    return { ...snapshot, activeTurnId: null, status: "idle" };
  }
  if (event.method === "thread/status/changed") {
    return { ...snapshot, status: runtimeStatus(asRecord(event.raw.params).status) };
  }
  return snapshot;
}

function isThreadStreamConfiguration(configuration: JsonObject) {
  return configuration.threadId === null || typeof configuration.threadId === "string";
}

function threadIdFrom(configuration: JsonObject) {
  return typeof configuration.threadId === "string" && configuration.threadId
    ? configuration.threadId
    : null;
}

function threadLabel(thread: ThreadSummary) {
  return thread.name || thread.preview || thread.threadId;
}

function runtimeStatus(value: unknown): ThreadRuntimeStatus {
  const status = typeof value === "string" ? value : stringValue(asRecord(value).type);
  return ["notLoaded", "idle", "active", "systemError"].includes(status ?? "")
    ? status as ThreadRuntimeStatus
    : "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}
