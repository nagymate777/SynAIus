# ADR 0002: one command core for every actor

Status: accepted

The UI, MCP servers, hooks, automations and AI agents do not write layout state directly. They submit versioned commands with an expected revision. The domain core validates invariants, creates the next immutable state and emits an event suitable for persistence, audit and replay.
