# Foundation constraints

1. The Hungarian catalog is the only hand-maintained language catalog during initial development.
2. User, MCP, hook, automation and AI mutations enter through the same versioned command core.
3. Layout coordinates are integer grid coordinates relative to the containing box.
4. Stable IDs and user-editable unique names are separate fields.
5. Temporary removal uses explicit cut/paste between named views; destructive deletion remains a separate action.
6. GitHub is the source of code, schemas and signed releases; it is not the high-frequency runtime database.
7. Thread streaming is cursor-based and durable. Raw app-server events are stored before derived events are broadcast.
8. A client can attach by thread ID regardless of which SynAIus surface created the thread.
9. Public source must never contain credentials, personal information or machine-local runtime state.
10. Views own box identity and content; dynamically extensible device-layout profiles own per-layout geometry, while default-view selection remains a separate concern.
11. Runtime-editable localized content uses stable language keys in the workspace catalog so it participates in the same translation workflow as static interface text.
12. Structural editing is explicitly lockable. A locked workspace remains navigable and exportable, but rejects layout and content mutations from the portal.
13. Session undo/redo and named persistent snapshots are separate recovery layers. Snapshot and import payloads are schema-validated and migrated before activation.
14. Device geometry can be copied through the versioned command core at box or whole-view scope; content identity remains shared.
15. Clones are independent boxes with a durable source relationship. Their localized generated names follow source renames automatically.
16. The canvas camera is machine-local view state. Pan and zoom never rewrite box grid geometry, while placement still snaps through the shared grid core.
17. The desktop, tablet and mobile layout profiles are protected compatibility anchors. User-created profiles can be copied and deleted without deleting shared box identity or content.
18. A box hidden outside editing remains persisted and editable while structural editing is unlocked. Hiding a parent hides its descendants when editing is locked.
