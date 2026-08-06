# SynAIus repository rules

- Treat this repository as public. Never add credentials, tokens, private keys, personal data, machine-local configuration, runtime databases, screenshots containing private data, or private infrastructure details.
- Run `npm run check:secrets` before every commit and immediately before every push.
- User-visible interface text must be referenced by a language key. During the initial development phase, maintain only `locales/hu.json`.
- UI actions, MCP tools, hooks, and automation must call the same versioned domain-command layer. Do not mutate persisted layout state directly.
- Keep stable machine identifiers separate from user-editable unique names.
- Persist raw app-server events before broadcasting derived stream events. Reconnection must support cursor replay and thread reconciliation.
- Use Codex Conductor as the reference for app-server transport and recovery behavior. Do not copy its full bridge, server, store, scheduler, or UI.
- Before reusing code from another project, add a focused entry under `docs/reuse/` recording the exact source commit, copied files or functions, dependencies, tests, and reason for reuse.
- Prefer a clean-room implementation from behavior and tests when the source unit is coupled to unrelated features.
- Keep changes small, typed, tested, and migration-aware. Preserve unrelated user changes.
