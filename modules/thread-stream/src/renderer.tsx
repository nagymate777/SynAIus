import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ContentInstance, ContentRendererDefinition, JsonObject } from "@synaius/content";
import { createTranslator, type TranslationDictionary } from "@synaius/i18n";
import type {
  CodexModelSummary,
  ArtifactFileEntry,
  DurableThreadEvent,
  PendingThreadInteraction,
  ServerRequestId,
  ThreadInteractionResponse,
  ThreadRuntimeStatus,
  ThreadSnapshot,
  ThreadStreamGateway,
  ThreadSummary,
} from "@synaius/protocol";
import type { WorkspaceContentRenderContext } from "@synaius/workspace-ui";
import {
  createThreadStreamFilters,
  eventUnreadKey,
  filterThreadLines,
  projectThreadTurnEvent,
  projectThreadTurns,
  type ThreadActivity,
  type ThreadActivityStatus,
  type ThreadStreamFilter,
  type ThreadStreamFilterState,
  type ThreadStreamLine,
  type ThreadTurnGroup,
} from "./activity.ts";
import { projectThreadArtifactFiles } from "./artifact-index.ts";
import { THREAD_STREAM_CONTENT_TYPE, THREAD_STREAM_RENDERER_VERSION } from "./index";
import "./thread-stream.css";

export {
  createThreadStreamFilters,
  eventUnreadKey,
  filterThreadLines,
  projectThreadEvent,
  projectThreadSnapshot,
  projectThreadTurnEvent,
  projectThreadTurns,
} from "./activity.ts";
export { projectThreadArtifactFiles } from "./artifact-index.ts";
export type {
  ThreadActivity,
  ThreadActivityStatus,
  ThreadStreamFilter,
  ThreadStreamFilterState,
  ThreadStreamLine,
  ThreadTurnGroup,
  ThreadTurnStatus,
} from "./activity.ts";

const THREAD_STREAM_FILTERS: ThreadStreamFilter[] = [
  "messages",
  "commands",
  "files",
  "tools",
  "errors",
];

const THREAD_STREAM_FILTER_KEYS: Record<ThreadStreamFilter, string> = {
  messages: "module.thread-stream.filter.messages",
  commands: "module.thread-stream.filter.commands",
  files: "module.thread-stream.filter.files",
  tools: "module.thread-stream.filter.tools",
  errors: "module.thread-stream.filter.errors",
};

export interface ThreadStreamRendererOptions {
  gateway: ThreadStreamGateway;
  localeMessages: TranslationDictionary;
  onOpenFile?: (
    input: { threadId: string; path: string },
    context: WorkspaceContentRenderContext,
  ) => void;
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
        onOpenFile={options.onOpenFile}
        t={t}
      />
    ),
  };
}

function ThreadStreamPanel({
  content,
  context,
  gateway,
  onOpenFile,
  t,
}: {
  content: ContentInstance;
  context: WorkspaceContentRenderContext;
  gateway: ThreadStreamGateway;
  onOpenFile?: ThreadStreamRendererOptions["onOpenFile"];
  t: ReturnType<typeof createTranslator>;
}) {
  const configuredThreadId = threadIdFrom(content.configuration);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadSearch, setThreadSearch] = useState("");
  const [threadCursor, setThreadCursor] = useState<string | null>(null);
  const [threadListBusy, setThreadListBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null);
  const [turns, setTurns] = useState<ThreadTurnGroup[]>([]);
  const [filters, setFilters] = useState<ThreadStreamFilterState>(createThreadStreamFilters);
  const [unreadKeys, setUnreadKeys] = useState<Set<string>>(() => new Set());
  const [following, setFollowing] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [connectionKey, setConnectionKey] = useState("module.thread-stream.connection.connecting");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [models, setModels] = useState<CodexModelSummary[]>([]);
  const [modelCursor, setModelCursor] = useState<string | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedEffort, setSelectedEffort] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [interactions, setInteractions] = useState<PendingThreadInteraction[]>([]);
  const [respondingRequestId, setRespondingRequestId] = useState<ServerRequestId | null>(null);
  const [artifactBrowserOpen, setArtifactBrowserOpen] = useState(false);
  const [artifactSearch, setArtifactSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setThreadListBusy(true);
      setErrorKey(null);
      gateway.listThreads({ limit: 25, searchTerm: threadSearch })
        .then((page) => {
          if (cancelled) return;
          setThreads(page.threads);
          setThreadCursor(page.nextCursor);
        })
        .catch((error) => {
          if (!cancelled) {
            console.error("thread-stream.list.failed", error);
            setErrorKey("module.thread-stream.error.list");
          }
        })
        .finally(() => {
          if (!cancelled) setThreadListBusy(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [gateway, threadSearch]);

  useEffect(() => {
    if (!newThreadOpen || models.length) return;
    let cancelled = false;
    setModelsBusy(true);
    setErrorKey(null);
    gateway.listModels(null, 100)
      .then((page) => {
        if (cancelled) return;
        setModels(page.models);
        setModelCursor(page.nextCursor);
        const preferred = page.models.find((model) => model.isDefault) ?? page.models[0];
        if (preferred) {
          setSelectedModel(preferred.id);
          setSelectedEffort(preferred.defaultReasoningEffort);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("thread-stream.models.failed", error);
          setErrorKey("module.thread-stream.error.models");
        }
      })
      .finally(() => {
        if (!cancelled) setModelsBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gateway, models.length, newThreadOpen]);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => Promise<void>) | null = null;
    setSnapshot(null);
    setTurns([]);
    setInteractions([]);
    followingRef.current = true;
    setFollowing(true);
    setUnreadKeys(new Set());
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
      setTurns(projectThreadTurns(attachment.snapshot));
      setInteractions(await gateway.listInteractions(configuredThreadId));
      if (cancelled) return;
      setConnectionKey(attachment.snapshot.accessMode === "observe"
        ? "module.thread-stream.connection.observe"
        : "module.thread-stream.connection.live");
      for await (const event of attachment.events) {
        if (cancelled) break;
        setInteractions((current) => projectThreadInteractions(current, event));
        if (event.method === "gateway/snapshotChanged") {
          const refreshed = await gateway.readThread(configuredThreadId);
          if (cancelled) break;
          if (!followingRef.current) {
            const key = eventUnreadKey(event);
            if (key) {
              setUnreadKeys((current) => current.has(key)
                ? current
                : new Set([...current, key]));
            }
          }
          setSnapshot(refreshed);
          setTurns(projectThreadTurns(refreshed));
          setConnectionKey("module.thread-stream.connection.observe");
          continue;
        }
        if (!followingRef.current) {
          const key = eventUnreadKey(event);
          if (key) {
            setUnreadKeys((current) => current.has(key)
              ? current
              : new Set([...current, key]));
          }
        }
        setTurns((current) => projectThreadTurnEvent(current, event));
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
      if (detach) void detach().catch((error) => console.error("thread-stream.detach.failed", error));
    };
  }, [configuredThreadId, gateway]);

  useEffect(() => {
    if (newThreadOpen || !followingRef.current) return;
    const frame = requestAnimationFrame(() => {
      const log = logRef.current;
      if (log) log.scrollTop = log.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [filters, interactions, newThreadOpen, turns]);

  const selectedLabel = useMemo(() => {
    const selected = threads.find((thread) => thread.threadId === configuredThreadId);
    return selected ? threadLabel(selected) : configuredThreadId;
  }, [configuredThreadId, threads]);

  const visibleTurns = useMemo(() => turns.flatMap((turn, turnIndex) => {
    const visibleLines = filterThreadLines(turn.lines, filters);
    const visibleWithoutLines = turn.status === "inProgress"
      || (turn.status === "failed" && filters.errors);
    return visibleLines.length || visibleWithoutLines ? [{ turn, turnIndex, visibleLines }] : [];
  }), [filters, turns]);
  const artifactFiles = useMemo(() => projectThreadArtifactFiles(turns), [turns]);
  const visibleArtifactFiles = useMemo(() => {
    const query = artifactSearch.trim().toLocaleLowerCase();
    return query
      ? artifactFiles.filter((file) => file.path.toLocaleLowerCase().includes(query))
      : artifactFiles;
  }, [artifactFiles, artifactSearch]);

  function toggleFilter(filter: ThreadStreamFilter) {
    setFilters((current) => ({ ...current, [filter]: !current[filter] }));
  }

  function showAllFilters() {
    setFilters(createThreadStreamFilters());
  }

  function handleLogScroll() {
    const log = logRef.current;
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight <= 32;
    followingRef.current = atBottom;
    setFollowing(atBottom);
    if (atBottom) setUnreadKeys((current) => current.size ? new Set() : current);
  }

  function jumpToLatest() {
    followingRef.current = true;
    setFollowing(true);
    setUnreadKeys(new Set());
    const log = logRef.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }

  function openFile(path: string) {
    if (!configuredThreadId) return;
    onOpenFile?.({ threadId: configuredThreadId, path }, context);
  }

  function selectThread(threadId: string) {
    setNewThreadOpen(false);
    setArtifactBrowserOpen(false);
    setArtifactSearch("");
    context.execute("content.configure", {
      contentId: content.id,
      configuration: { ...content.configuration, threadId: threadId || null },
    });
  }

  async function loadMoreThreads() {
    if (!threadCursor || threadListBusy) return;
    setThreadListBusy(true);
    try {
      const page = await gateway.listThreads({
        cursor: threadCursor,
        limit: 25,
        searchTerm: threadSearch,
      });
      setThreads((current) => uniqueThreads([...current, ...page.threads]));
      setThreadCursor(page.nextCursor);
    } catch (error) {
      console.error("thread-stream.listMore.failed", error);
      setErrorKey("module.thread-stream.error.list");
    } finally {
      setThreadListBusy(false);
    }
  }

  async function loadMoreModels() {
    if (!modelCursor || modelsBusy) return;
    setModelsBusy(true);
    try {
      const page = await gateway.listModels(modelCursor, 100);
      setModels((current) => [...current, ...page.models]);
      setModelCursor(page.nextCursor);
    } catch (error) {
      console.error("thread-stream.modelsMore.failed", error);
      setErrorKey("module.thread-stream.error.models");
    } finally {
      setModelsBusy(false);
    }
  }

  function changeModel(modelId: string) {
    setSelectedModel(modelId);
    const model = models.find((candidate) => candidate.id === modelId);
    setSelectedEffort(model?.defaultReasoningEffort ?? "");
  }

  async function createThread(event: FormEvent) {
    event.preventDefault();
    if (!selectedModel || !initialMessage.trim() || actionBusy) return;
    setActionBusy(true);
    setErrorKey(null);
    try {
      const created = await gateway.createThread({
        model: selectedModel,
        effort: selectedEffort || null,
        cwd: workingDirectory.trim() || null,
        message: initialMessage.trim(),
      });
      context.execute("content.configure", {
        contentId: content.id,
        configuration: { ...content.configuration, threadId: created.threadId },
      });
      setNewThreadOpen(false);
      setInitialMessage("");
      setWorkingDirectory("");
      setSnapshot(created);
      setTurns(projectThreadTurns(created));
    } catch (error) {
      console.error("thread-stream.create.failed", error);
      setErrorKey("module.thread-stream.error.create");
    } finally {
      setActionBusy(false);
    }
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!configuredThreadId || !snapshot || !draft.trim() || actionBusy) return;
    if (snapshot.accessMode === "observe") return;
    const message = draft.trim();
    setActionBusy(true);
    setErrorKey(null);
    try {
      if (snapshot.activeTurnId) {
        await gateway.steerTurn(configuredThreadId, snapshot.activeTurnId, message);
      } else {
        await gateway.startTurn(configuredThreadId, message);
      }
      setDraft("");
    } catch (error) {
      console.error("thread-stream.message.failed", error);
      setErrorKey(snapshot.activeTurnId
        ? "module.thread-stream.error.steer"
        : "module.thread-stream.error.startTurn");
    } finally {
      setActionBusy(false);
    }
  }

  function interrupt() {
    if (!configuredThreadId || !snapshot?.activeTurnId) return;
    void gateway.interruptTurn(configuredThreadId, snapshot.activeTurnId).catch(() => {
      setErrorKey("module.thread-stream.error.interrupt");
    });
  }

  async function respondToInteraction(
    interaction: PendingThreadInteraction,
    response: ThreadInteractionResponse,
  ) {
    if (!configuredThreadId || respondingRequestId !== null) return;
    setRespondingRequestId(interaction.requestId);
    setErrorKey(null);
    try {
      await gateway.respondToInteraction(configuredThreadId, interaction.requestId, response);
      setInteractions((current) => current.filter(
        (candidate) => !sameRequestId(candidate.requestId, interaction.requestId),
      ));
    } catch (error) {
      console.error("thread-stream.interaction.failed", error);
      setErrorKey("module.thread-stream.error.interaction");
    } finally {
      setRespondingRequestId(null);
    }
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
          {configuredThreadId && !threads.some((thread) => thread.threadId === configuredThreadId) && (
            <option value={configuredThreadId}>{configuredThreadId}</option>
          )}
          {threads.map((thread) => (
            <option key={thread.threadId} value={thread.threadId}>{threadLabel(thread)}</option>
          ))}
        </select>
        <span className="thread-stream-connection" data-status={snapshot?.status ?? "unknown"}>
          {t(connectionKey)}
        </span>
      </header>
      <div className="thread-stream-browser">
        <input
          aria-label={t("module.thread-stream.thread.search.label")}
          onChange={(event) => setThreadSearch(event.target.value)}
          placeholder={t("module.thread-stream.thread.search.placeholder")}
          type="search"
          value={threadSearch}
        />
        {threadCursor && (
          <button disabled={threadListBusy} onClick={() => void loadMoreThreads()} type="button">
            {t("module.thread-stream.action.loadMore")}
          </button>
        )}
        <button onClick={() => setNewThreadOpen((value) => !value)} type="button">
          {t(newThreadOpen
            ? "module.thread-stream.action.closeNewThread"
            : "module.thread-stream.action.newThread")}
        </button>
      </div>
      <div className="thread-stream-title">{selectedLabel}</div>
      {!newThreadOpen && configuredThreadId && (
        <div className="thread-stream-controls">
          <div
            aria-label={t("module.thread-stream.filter.label")}
            className="thread-stream-filters"
            role="group"
          >
            {THREAD_STREAM_FILTERS.map((filter) => (
              <button
                aria-pressed={filters[filter]}
                data-active={filters[filter]}
                key={filter}
                onClick={() => toggleFilter(filter)}
                type="button"
              >
                {t(THREAD_STREAM_FILTER_KEYS[filter])}
              </button>
            ))}
            <button onClick={showAllFilters} type="button">
              {t("module.thread-stream.filter.all")}
            </button>
          </div>
          <button
            aria-pressed={artifactBrowserOpen}
            className="thread-stream-artifacts-toggle"
            onClick={() => setArtifactBrowserOpen((value) => !value)}
            type="button"
          >
            {artifactBrowserOpen
              ? t("module.thread-stream.artifacts.close")
              : t("module.thread-stream.artifacts.open", { count: artifactFiles.length })}
          </button>
          {(!following || unreadKeys.size > 0) && (
            <button className="thread-stream-latest" onClick={jumpToLatest} type="button">
              {unreadKeys.size > 0
                ? t("module.thread-stream.latest.unread", { count: unreadKeys.size })
                : t("module.thread-stream.latest")}
            </button>
          )}
        </div>
      )}
      {newThreadOpen ? (
        <form className="thread-stream-new" onSubmit={createThread}>
          <div className="thread-stream-new-title">{t("module.thread-stream.new.title")}</div>
          <label>
            <span>{t("module.thread-stream.model.label")}</span>
            <select
              disabled={modelsBusy || !models.length}
              onChange={(event) => changeModel(event.target.value)}
              value={selectedModel}
            >
              {!models.length && <option value="">{t("module.thread-stream.model.loading")}</option>}
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.displayName}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("module.thread-stream.effort.label")}</span>
            <select
              disabled={!selectedModel}
              onChange={(event) => setSelectedEffort(event.target.value)}
              value={selectedEffort}
            >
              {(models.find((model) => model.id === selectedModel)?.supportedReasoningEfforts ?? [])
                .map((effort) => (
                  <option key={effort.id} value={effort.id}>{effortLabel(t, effort.id)}</option>
                ))}
            </select>
          </label>
          <label>
            <span>{t("module.thread-stream.cwd.label")}</span>
            <input
              onChange={(event) => setWorkingDirectory(event.target.value)}
              placeholder={t("module.thread-stream.cwd.placeholder")}
              value={workingDirectory}
            />
          </label>
          <label className="thread-stream-new-message">
            <span>{t("module.thread-stream.new.message.label")}</span>
            <textarea
              onChange={(event) => setInitialMessage(event.target.value)}
              placeholder={t("module.thread-stream.new.message.placeholder")}
              value={initialMessage}
            />
          </label>
          <div className="thread-stream-new-actions">
            {modelCursor && (
              <button disabled={modelsBusy} onClick={() => void loadMoreModels()} type="button">
                {t("module.thread-stream.action.loadMoreModels")}
              </button>
            )}
            <button disabled={actionBusy || !selectedModel || !initialMessage.trim()} type="submit">
              {t("module.thread-stream.action.createThread")}
            </button>
          </div>
        </form>
      ) : artifactBrowserOpen ? (
        <ThreadArtifactBrowser
          files={visibleArtifactFiles}
          onOpenFile={onOpenFile ? openFile : undefined}
          onSearch={setArtifactSearch}
          search={artifactSearch}
          t={t}
          total={artifactFiles.length}
        />
      ) : (
        <div
          className="thread-stream-log"
          aria-live="polite"
          onScroll={handleLogScroll}
          ref={logRef}
        >
          {interactions.length > 0 && (
            <div className="thread-stream-interactions">
              {interactions.map((interaction) => (
                <ThreadInteractionCard
                  busy={respondingRequestId !== null}
                  interaction={interaction}
                  key={requestKey(interaction.requestId)}
                  onRespond={(response) => void respondToInteraction(interaction, response)}
                  t={t}
                />
              ))}
            </div>
          )}
          {!configuredThreadId && (
            <p className="thread-stream-empty">{t("module.thread-stream.thread.choose")}</p>
          )}
          {configuredThreadId && turns.length === 0 && interactions.length === 0 && !errorKey && (
            <p className="thread-stream-empty">{t("module.thread-stream.thread.waiting")}</p>
          )}
          {configuredThreadId && turns.length > 0 && visibleTurns.length === 0 && (
            <p className="thread-stream-empty">{t("module.thread-stream.filter.empty")}</p>
          )}
          {visibleTurns.map(({ turn, turnIndex, visibleLines }) => (
            <ThreadTurnCard
              hasUnread={unreadKeys.has(`turn:${turn.id}`) || turn.lines.some(
                (line) => unreadKeys.has(line.id),
              )}
              isLatest={turnIndex === turns.length - 1}
              key={turn.id}
              number={turnIndex + 1}
              onOpenFile={onOpenFile ? openFile : undefined}
              t={t}
              turn={turn}
              visibleLines={visibleLines}
            />
          ))}
        </div>
      )}
      <div className="thread-stream-error" role="alert">{errorKey ? t(errorKey) : ""}</div>
      <form className="thread-stream-compose" hidden={newThreadOpen} onSubmit={submitMessage}>
        <input
          aria-label={t("module.thread-stream.message.label")}
          disabled={!snapshot || snapshot.accessMode === "observe"}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("module.thread-stream.message.placeholder")}
          value={draft}
        />
        <button disabled={!snapshot || snapshot.accessMode === "observe" || !draft.trim() || actionBusy} type="submit">
          {t(snapshot?.activeTurnId
            ? "module.thread-stream.action.steer"
            : "module.thread-stream.action.startTurn")}
        </button>
        <button disabled={!snapshot?.activeTurnId || snapshot.accessMode === "observe"} onClick={interrupt} type="button">
          {t("module.thread-stream.action.interrupt")}
        </button>
      </form>
    </section>
  );
}

function ThreadArtifactBrowser({
  files,
  total,
  search,
  onSearch,
  onOpenFile,
  t,
}: {
  files: ArtifactFileEntry[];
  total: number;
  search: string;
  onSearch(value: string): void;
  onOpenFile?: (path: string) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  return (
    <section className="thread-stream-artifacts">
      <header>
        <input
          aria-label={t("module.thread-stream.artifacts.search.label")}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t("module.thread-stream.artifacts.search.placeholder")}
          type="search"
          value={search}
        />
        <span>{search
          ? t("module.thread-stream.artifacts.count.filtered", { visible: files.length, total })
          : t("module.thread-stream.artifacts.count", { count: total })}</span>
      </header>
      <div className="thread-stream-artifact-list">
        {files.map((file) => (
          <article data-kind={file.changeKind} key={file.path}>
            <div>
              <strong>{file.name}</strong>
              <code>{file.path}</code>
            </div>
            <span>{t(fileChangeKindKey(file.changeKind))}</span>
            <small>{t("module.thread-stream.artifacts.changes", { count: file.occurrences })}</small>
            {onOpenFile && (file.changeKind !== "delete" || Boolean(file.diff)) && (
              <button onClick={() => onOpenFile(file.path)} type="button">
                {t("module.thread-stream.artifacts.show")}
              </button>
            )}
          </article>
        ))}
        {!files.length && (
          <p>{t(search
            ? "module.thread-stream.artifacts.empty.filtered"
            : "module.thread-stream.artifacts.empty")}</p>
        )}
      </div>
    </section>
  );
}

function ThreadTurnCard({
  turn,
  visibleLines,
  number,
  isLatest,
  hasUnread,
  onOpenFile,
  t,
}: {
  turn: ThreadTurnGroup;
  visibleLines: ThreadStreamLine[];
  number: number;
  isLatest: boolean;
  hasUnread: boolean;
  onOpenFile?: (path: string) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  const [open, setOpen] = useState(turn.status === "inProgress" || isLatest);
  useEffect(() => {
    if (turn.status === "inProgress") setOpen(true);
  }, [turn.status]);
  const previewLine = turn.lines.find((line) => line.kind === "user")
    ?? turn.lines.find((line) => line.kind === "agent");
  const preview = previewLine?.text ?? "";
  return (
    <details
      className="thread-stream-turn"
      data-status={turn.status}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>
        <span aria-hidden="true" className="thread-stream-disclosure" />
        <span className="thread-stream-turn-title">
          {t("module.thread-stream.turn.title", { number })}
        </span>
        {preview && <span className="thread-stream-turn-preview">{preview}</span>}
        <span className="thread-stream-turn-count">
          {visibleLines.length === turn.lines.length
            ? t("module.thread-stream.turn.entries", { count: turn.lines.length })
            : t("module.thread-stream.turn.entries.visible", {
                visible: visibleLines.length,
                total: turn.lines.length,
              })}
        </span>
        <span className="thread-stream-turn-status">{t(turnStatusKey(turn.status))}</span>
        {hasUnread && (
          <span
            aria-label={t("module.thread-stream.turn.unread")}
            className="thread-stream-turn-unread"
            role="img"
            title={t("module.thread-stream.turn.unread")}
          />
        )}
      </summary>
      {open && (
        <div className="thread-stream-turn-body">
          {turn.error && (
            <div className="thread-stream-turn-error" role="alert">
              <strong>{t("module.thread-stream.turn.error")}</strong>
              <span>{turn.error}</span>
            </div>
          )}
          {visibleLines.length === 0 && (
            <p className="thread-stream-empty">{t("module.thread-stream.turn.filtered.empty")}</p>
          )}
          {visibleLines.map((line) => (
            <ThreadStreamEntry key={line.id} line={line} onOpenFile={onOpenFile} t={t} />
          ))}
        </div>
      )}
    </details>
  );
}

function ThreadStreamEntry({
  line,
  onOpenFile,
  t,
}: {
  line: ThreadStreamLine;
  onOpenFile?: (path: string) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  return line.kind === "activity"
    ? <ThreadActivityCard activity={line.activity} onOpenFile={onOpenFile} t={t} />
    : (
        <article className="thread-stream-line" data-kind={line.kind}>
          {line.text}
        </article>
      );
}

function ThreadActivityCard({
  activity,
  onOpenFile,
  t,
}: {
  activity: ThreadActivity;
  onOpenFile?: (path: string) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  const [open, setOpen] = useState(activity.status === "inProgress" || activity.status === "failed");
  useEffect(() => {
    if (activity.status === "failed") setOpen(true);
  }, [activity.status]);
  const summary = activitySummary(activity, t);
  return (
    <details
      className="thread-stream-activity"
      data-kind={activity.kind}
      data-status={activity.status}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>
        <span aria-hidden="true" className="thread-stream-disclosure" />
        <span className="thread-stream-activity-title">{t(activityTitleKey(activity.kind))}</span>
        {summary && <code>{summary}</code>}
        <span className="thread-stream-activity-status">{t(activityStatusKey(activity.status))}</span>
      </summary>
      {open && <div className="thread-stream-activity-body">
        {activity.kind === "command" && (
          <>
            {activity.command && (
              <ActivityDetail label={t("module.thread-stream.activity.command")} value={activity.command} />
            )}
            {activity.cwd && (
              <ActivityDetail label={t("module.thread-stream.activity.cwd")} value={activity.cwd} />
            )}
            {activity.exitCode !== null && (
              <ActivityDetail
                label={t("module.thread-stream.activity.exitCode")}
                value={String(activity.exitCode)}
              />
            )}
            {activity.durationMs !== null && (
              <ActivityDetail
                label={t("module.thread-stream.activity.duration")}
                value={t("module.thread-stream.activity.duration.ms", {
                  duration: Math.round(activity.durationMs),
                })}
              />
            )}
            {activity.output && (
              <ActivityCodeBlock
                label={t("module.thread-stream.activity.output")}
                value={activity.output}
              />
            )}
          </>
        )}
        {activity.kind === "fileChange" && (
          <div className="thread-stream-file-changes">
            {activity.changes.map((change, index) => (
              <details className="thread-stream-file-change" key={`${index}:${change.path}`}>
                <summary>
                  <span aria-hidden="true" className="thread-stream-disclosure" />
                  <span data-kind={change.kind}>{t(fileChangeKindKey(change.kind))}</span>
                  <code>{change.path}</code>
                </summary>
                {change.diff
                  ? <pre>{change.diff}</pre>
                  : <p>{t("module.thread-stream.activity.diff.empty")}</p>}
                {onOpenFile && change.kind !== "delete" && (
                  <button
                    className="thread-stream-file-open"
                    onClick={() => onOpenFile(change.path)}
                    type="button"
                  >
                    {t("module.thread-stream.activity.file.open")}
                  </button>
                )}
              </details>
            ))}
            {!activity.changes.length && (
              <p>{t("module.thread-stream.activity.files.empty")}</p>
            )}
          </div>
        )}
        {activity.kind === "turnDiff" && (
          activity.diff
            ? <ActivityCodeBlock label={t("module.thread-stream.activity.diff")} value={activity.diff} />
            : <p>{t("module.thread-stream.activity.diff.empty")}</p>
        )}
        {activity.kind === "mcpTool" && (
          <>
            {activity.server && (
              <ActivityDetail label={t("module.thread-stream.activity.server")} value={activity.server} />
            )}
            {activity.tool && (
              <ActivityDetail label={t("module.thread-stream.activity.tool")} value={activity.tool} />
            )}
            {activity.durationMs !== null && (
              <ActivityDetail
                label={t("module.thread-stream.activity.duration")}
                value={t("module.thread-stream.activity.duration.ms", {
                  duration: Math.round(activity.durationMs),
                })}
              />
            )}
            {activity.argumentsPreview && (
              <ActivityCodeBlock
                label={t("module.thread-stream.activity.arguments")}
                value={activity.argumentsPreview}
              />
            )}
            {activity.progress.length > 0 && (
              <ActivityCodeBlock
                label={t("module.thread-stream.activity.progress")}
                value={activity.progress.join("\n")}
              />
            )}
            {activity.resultPreview && (
              <ActivityCodeBlock
                label={t("module.thread-stream.activity.result")}
                value={activity.resultPreview}
              />
            )}
            {activity.error && (
              <ActivityCodeBlock
                error
                label={t("module.thread-stream.activity.error")}
                value={activity.error}
              />
            )}
          </>
        )}
        {activity.kind === "dynamicTool" && (
          <>
            {activity.namespace && (
              <ActivityDetail label={t("module.thread-stream.activity.namespace")} value={activity.namespace} />
            )}
            {activity.tool && (
              <ActivityDetail label={t("module.thread-stream.activity.tool")} value={activity.tool} />
            )}
            {activity.durationMs !== null && (
              <ActivityDetail
                label={t("module.thread-stream.activity.duration")}
                value={t("module.thread-stream.activity.duration.ms", {
                  duration: Math.round(activity.durationMs),
                })}
              />
            )}
            {activity.success !== null && (
              <ActivityDetail
                label={t("module.thread-stream.activity.success")}
                value={t(activity.success
                  ? "module.thread-stream.activity.boolean.yes"
                  : "module.thread-stream.activity.boolean.no")}
              />
            )}
            {activity.argumentsPreview && (
              <ActivityCodeBlock
                label={t("module.thread-stream.activity.arguments")}
                value={activity.argumentsPreview}
              />
            )}
            {activity.resultPreview && (
              <ActivityCodeBlock
                label={t("module.thread-stream.activity.result")}
                value={activity.resultPreview}
              />
            )}
          </>
        )}
      </div>}
    </details>
  );
}

function ActivityDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="thread-stream-activity-detail">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

function ActivityCodeBlock({
  label,
  value,
  error = false,
}: {
  label: string;
  value: string;
  error?: boolean;
}) {
  return (
    <div className="thread-stream-activity-code" data-error={error}>
      <span>{label}</span>
      <pre>{value}</pre>
    </div>
  );
}

function activitySummary(
  activity: ThreadActivity,
  t: ReturnType<typeof createTranslator>,
) {
  if (activity.kind === "command") return activity.command.split(/\r?\n/, 1)[0];
  if (activity.kind === "fileChange") {
    return t("module.thread-stream.activity.files.count", { count: activity.changes.length });
  }
  if (activity.kind === "mcpTool") return [activity.server, activity.tool].filter(Boolean).join(" / ");
  if (activity.kind === "dynamicTool") return [activity.namespace, activity.tool].filter(Boolean).join(" / ");
  return "";
}

function activityTitleKey(kind: ThreadActivity["kind"]) {
  const keys: Record<ThreadActivity["kind"], string> = {
    command: "module.thread-stream.activity.command.title",
    fileChange: "module.thread-stream.activity.fileChange.title",
    turnDiff: "module.thread-stream.activity.turnDiff.title",
    mcpTool: "module.thread-stream.activity.mcpTool.title",
    dynamicTool: "module.thread-stream.activity.dynamicTool.title",
  };
  return keys[kind];
}

function activityStatusKey(status: ThreadActivityStatus) {
  return `module.thread-stream.activity.status.${status}`;
}

function turnStatusKey(status: ThreadTurnGroup["status"]) {
  const keys: Record<ThreadTurnGroup["status"], string> = {
    inProgress: "module.thread-stream.activity.status.inProgress",
    completed: "module.thread-stream.activity.status.completed",
    failed: "module.thread-stream.activity.status.failed",
    interrupted: "module.thread-stream.activity.status.interrupted",
    unknown: "module.thread-stream.activity.status.unknown",
  };
  return keys[status];
}

function fileChangeKindKey(kind: "add" | "update" | "delete" | "unknown") {
  return `module.thread-stream.activity.fileKind.${kind}`;
}

function ThreadInteractionCard({
  interaction,
  busy,
  onRespond,
  t,
}: {
  interaction: PendingThreadInteraction;
  busy: boolean;
  onRespond(response: ThreadInteractionResponse): void;
  t: ReturnType<typeof createTranslator>;
}) {
  if (interaction.kind === "userInput") {
    return (
      <UserInputInteraction
        busy={busy}
        interaction={interaction}
        onRespond={onRespond}
        t={t}
      />
    );
  }
  const titleKey = interaction.kind === "commandApproval"
    ? interaction.networkHost
      ? "module.thread-stream.interaction.network.title"
      : "module.thread-stream.interaction.command.title"
    : interaction.kind === "fileApproval"
      ? "module.thread-stream.interaction.file.title"
      : interaction.kind === "permissionsApproval"
        ? "module.thread-stream.interaction.permissions.title"
        : "module.thread-stream.interaction.mcp.title";
  return (
    <article className="thread-stream-interaction" data-kind={interaction.kind}>
      <strong>{t(titleKey)}</strong>
      {(interaction.kind === "commandApproval" || interaction.kind === "fileApproval"
        || interaction.kind === "permissionsApproval") && interaction.reason && (
        <InteractionDetail label={t("module.thread-stream.interaction.reason")} value={interaction.reason} />
      )}
      {interaction.kind === "commandApproval" && interaction.command && (
        <InteractionDetail code label={t("module.thread-stream.interaction.command")} value={interaction.command} />
      )}
      {interaction.kind === "commandApproval" && interaction.cwd && (
        <InteractionDetail code label={t("module.thread-stream.interaction.cwd")} value={interaction.cwd} />
      )}
      {interaction.kind === "commandApproval" && interaction.networkHost && (
        <InteractionDetail
          code
          label={t("module.thread-stream.interaction.host")}
          value={`${interaction.networkProtocol ?? ""}://${interaction.networkHost}`}
        />
      )}
      {interaction.kind === "fileApproval" && interaction.grantRoot && (
        <InteractionDetail code label={t("module.thread-stream.interaction.root")} value={interaction.grantRoot} />
      )}
      {interaction.kind === "permissionsApproval" && interaction.cwd && (
        <InteractionDetail code label={t("module.thread-stream.interaction.cwd")} value={interaction.cwd} />
      )}
      {interaction.kind === "permissionsApproval" && (
        <pre className="thread-stream-interaction-permissions">
          {JSON.stringify(interaction.requestedPermissions, null, 2)}
        </pre>
      )}
      {interaction.kind === "mcpElicitation" && (
        <>
          <InteractionDetail label={t("module.thread-stream.interaction.server")} value={interaction.serverName} />
          <InteractionDetail label={t("module.thread-stream.interaction.message")} value={interaction.message} />
          {interaction.url && (
            <InteractionDetail code label={t("module.thread-stream.interaction.url")} value={interaction.url} />
          )}
          <p>{t("module.thread-stream.interaction.mcp.limited")}</p>
        </>
      )}
      <div className="thread-stream-interaction-actions">
        {(interaction.kind === "commandApproval" || interaction.kind === "fileApproval") && (
          <>
            <button disabled={busy} onClick={() => onRespond({ kind: "approval", decision: "accept" })} type="button">
              {t("module.thread-stream.interaction.action.accept")}
            </button>
            <button disabled={busy} onClick={() => onRespond({ kind: "approval", decision: "acceptForSession" })} type="button">
              {t("module.thread-stream.interaction.action.acceptSession")}
            </button>
            <button disabled={busy} onClick={() => onRespond({ kind: "approval", decision: "decline" })} type="button">
              {t("module.thread-stream.interaction.action.decline")}
            </button>
            <button disabled={busy} onClick={() => onRespond({ kind: "approval", decision: "cancel" })} type="button">
              {t("module.thread-stream.interaction.action.cancel")}
            </button>
          </>
        )}
        {interaction.kind === "permissionsApproval" && (
          <>
            <button disabled={busy} onClick={() => onRespond({ kind: "permissions", decision: "grantTurn" })} type="button">
              {t("module.thread-stream.interaction.action.grantTurn")}
            </button>
            <button disabled={busy} onClick={() => onRespond({ kind: "permissions", decision: "grantSession" })} type="button">
              {t("module.thread-stream.interaction.action.grantSession")}
            </button>
            <button disabled={busy} onClick={() => onRespond({ kind: "permissions", decision: "decline" })} type="button">
              {t("module.thread-stream.interaction.action.decline")}
            </button>
          </>
        )}
        {interaction.kind === "mcpElicitation" && (
          <>
            <button disabled={busy} onClick={() => onRespond({ kind: "mcpElicitation", action: "decline" })} type="button">
              {t("module.thread-stream.interaction.action.decline")}
            </button>
            <button disabled={busy} onClick={() => onRespond({ kind: "mcpElicitation", action: "cancel" })} type="button">
              {t("module.thread-stream.interaction.action.cancel")}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function UserInputInteraction({
  interaction,
  busy,
  onRespond,
  t,
}: {
  interaction: Extract<PendingThreadInteraction, { kind: "userInput" }>;
  busy: boolean;
  onRespond(response: ThreadInteractionResponse): void;
  t: ReturnType<typeof createTranslator>;
}) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const resolvedAnswers = Object.fromEntries(interaction.questions.map((question) => {
    if (!question.options?.length) return [question.id, answers[question.id]?.trim() ?? ""];
    const selection = selections[question.id] ?? "";
    if (selection === "other") return [question.id, answers[question.id]?.trim() ?? ""];
    const index = Number(selection.replace("option:", ""));
    return [question.id, question.options[index]?.label ?? ""];
  }));
  const complete = interaction.questions.every((question) => Boolean(resolvedAnswers[question.id]));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete || busy) return;
    onRespond({
      kind: "userInput",
      answers: Object.fromEntries(Object.entries(resolvedAnswers).map(([id, value]) => [id, [value]])),
    });
  }

  return (
    <form className="thread-stream-interaction" data-kind="userInput" onSubmit={submit}>
      <strong>{t("module.thread-stream.interaction.userInput.title")}</strong>
      {interaction.questions.map((question) => {
        const selection = selections[question.id] ?? "";
        const useTextInput = !question.options?.length || selection === "other";
        return (
          <fieldset key={question.id}>
            <legend>{question.header}</legend>
            <label>
              <span>{question.question}</span>
              {question.options?.length ? (
                <select
                  disabled={busy}
                  onChange={(event) => setSelections((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))}
                  value={selection}
                >
                  <option value="">{t("module.thread-stream.interaction.answer.choose")}</option>
                  {question.options.map((option, index) => (
                    <option key={`${index}:${option.label}`} value={`option:${index}`}>{option.label}</option>
                  ))}
                  {question.isOther && (
                    <option value="other">{t("module.thread-stream.interaction.answer.other")}</option>
                  )}
                </select>
              ) : null}
              {useTextInput && (
                <input
                  autoComplete="off"
                  disabled={busy}
                  onChange={(event) => setAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))}
                  type={question.isSecret ? "password" : "text"}
                  value={answers[question.id] ?? ""}
                />
              )}
            </label>
            {question.options?.map((option) => (
              <small key={option.label}>{option.label}: {option.description}</small>
            ))}
          </fieldset>
        );
      })}
      <div className="thread-stream-interaction-actions">
        <button disabled={busy || !complete} type="submit">
          {t("module.thread-stream.interaction.action.answer")}
        </button>
      </div>
    </form>
  );
}

function InteractionDetail({ label, value, code = false }: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="thread-stream-interaction-detail">
      <span>{label}</span>
      {code ? <code>{value}</code> : <div>{value}</div>}
    </div>
  );
}

export function projectThreadInteractions(
  current: PendingThreadInteraction[],
  event: DurableThreadEvent,
) {
  const params = asRecord(event.raw.params);
  if (event.method === "gateway/interactionRequested") {
    const interaction = pendingInteraction(params.interaction);
    if (!interaction) return current;
    return [
      ...current.filter((candidate) => !sameRequestId(candidate.requestId, interaction.requestId)),
      interaction,
    ];
  }
  if (event.method === "gateway/interactionsCleared") return [];
  if (event.method === "gateway/interactionResponded" || event.method === "serverRequest/resolved") {
    const requestId = serverRequestId(params.requestId);
    if (requestId === null) return current;
    return current.filter((interaction) => !sameRequestId(interaction.requestId, requestId));
  }
  if (event.method === "turn/completed" && event.turnId) {
    return current.filter((interaction) => interaction.turnId !== event.turnId);
  }
  return current;
}

function pendingInteraction(value: unknown): PendingThreadInteraction | null {
  const interaction = asRecord(value);
  const requestId = serverRequestId(interaction.requestId);
  const kind = interaction.kind;
  if (requestId === null || !["commandApproval", "fileApproval", "userInput", "permissionsApproval", "mcpElicitation"].includes(String(kind))) {
    return null;
  }
  return value as PendingThreadInteraction;
}

function serverRequestId(value: unknown): ServerRequestId | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function sameRequestId(left: ServerRequestId, right: ServerRequestId) {
  return typeof left === typeof right && left === right;
}

function requestKey(requestId: ServerRequestId) {
  return `${typeof requestId}:${String(requestId)}`;
}

function uniqueThreads(threads: ThreadSummary[]) {
  return [...new Map(threads.map((thread) => [thread.threadId, thread])).values()];
}

function effortLabel(t: ReturnType<typeof createTranslator>, effort: string) {
  const known: Record<string, string> = {
    none: "module.thread-stream.effort.none",
    minimal: "module.thread-stream.effort.minimal",
    low: "module.thread-stream.effort.low",
    medium: "module.thread-stream.effort.medium",
    high: "module.thread-stream.effort.high",
    xhigh: "module.thread-stream.effort.xhigh",
    max: "module.thread-stream.effort.max",
    ultra: "module.thread-stream.effort.ultra",
  };
  return known[effort] ? t(known[effort]) : t("module.thread-stream.effort.custom", { effort });
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
