# ADR 0003: durable thread-stream gateway

Status: accepted

The Codex app-server integration is isolated behind a thread-stream gateway. Attaching is based on a thread ID and durable cursor, not on ownership by the current browser or bridge process. Recovery reads the canonical thread, resumes when required, reconciles the active turn and replays persisted events before continuing live delivery.

The first implementation will derive its behavioral contract from Codex Conductor's tested JSONL/stdio client, generation-safe reconnect, bounded backoff, `thread/read`, `thread/resume`, durable event store and separate high-volume agent stream. The CodexWeb transport is not the reference implementation.
