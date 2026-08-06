# Foundation constraints

1. The Hungarian catalog is the only hand-maintained language catalog during initial development.
2. User, MCP, hook, automation and AI mutations enter through the same versioned command core.
3. Layout coordinates are integer grid coordinates relative to the containing box.
4. Stable IDs and user-editable unique names are separate fields.
5. Removal is recoverable archival until a separately authorized purge exists.
6. GitHub is the source of code, schemas and signed releases; it is not the high-frequency runtime database.
7. Thread streaming is cursor-based and durable. Raw app-server events are stored before derived events are broadcast.
8. A client can attach by thread ID regardless of which SynAIus surface created the thread.
9. Public source must never contain credentials, personal information or machine-local runtime state.
10. Views own box identity and content; device layouts own per-device geometry, while default-view selection remains a separate concern.
