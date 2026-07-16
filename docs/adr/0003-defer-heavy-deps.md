# ADR-0003 — Dependencies are added when their feature lands

**Status:** accepted · 2026-07-16

## Context

PLAN §5 lists the full dependency set up front (`@modelcontextprotocol/sdk`, `web-tree-sitter`, `execa`, …). Installing dependencies for phases that haven't started inflates the lockfile, widens the audit surface, and misrepresents what the code actually uses.

## Decision

Install a dependency in the same change that ships its feature:

- `@modelcontextprotocol/sdk` — phase 2 (MCP client + Semideus Learn bridge)
- `web-tree-sitter` — phase 1 (repo map)
- `execa` — not planned; `Bun.spawn` covers process execution (revisit only if Node compat becomes a distribution requirement)
- `@ai-sdk/openai` — when a direct OpenAI cloud provider is requested; `openai-compatible` covers local endpoints today

## Consequences

- `bun.lock` reflects reality; supply-chain review stays tractable for a solo builder.
- The phase-1/2 PRs that add these deps are the natural place to record any API-drift notes (as happened with AI SDK v7 at scaffold time).
