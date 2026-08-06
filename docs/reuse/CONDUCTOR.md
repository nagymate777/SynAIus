# Codex Conductor reuse ledger

Reference repository: `nagymate777/codex-conductor`

Reference commit reviewed: `c102444`

No source code has been copied in the initial SynAIus commit.

Behavior selected for isolated adaptation:

- JSONL/stdio initialization and request correlation;
- server-to-client request handling;
- stale child-process event rejection;
- bounded reconnect with state refresh;
- `thread/read` and `thread/resume` reconciliation;
- raw event persistence and monotonic replay cursors;
- separate delivery path for high-volume agent output;
- tests for restart, resume request shape and event recovery.

Explicitly excluded from copying:

- the complete bridge server;
- the SQLite store as a whole;
- scheduler, worktree and orchestration code;
- dashboard components and styling;
- locale catalogs;
- project-specific instructions and deployment state.
