# ADR 0001: one repository at project start

Status: accepted

Portal, domain packages, protocols, MCP servers and universal hooks begin in one npm workspace repository. This keeps protocol and release versions atomic while boundaries remain explicit packages. A component may move to another repository only after its public contract and independent release lifecycle are stable.
