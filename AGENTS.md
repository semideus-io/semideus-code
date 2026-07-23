# AGENTS.md — Semideus Code (`demi`)

Terminal coding agent. Bun + TypeScript monorepo. Persona: **Daimon** — advises and teaches, never acts without permission. The permission gate is the product contract, in code.

## Commands

- `bun install` — install everything (workspaces)
- `bun demi` — run the REPL from source · `bun demi -p "…"` — one-shot headless
- `bun test` — run all tests (colocated `*.test.ts`)
- `bun run typecheck` — `tsc --noEmit` over the whole monorepo
- `bun run check:fix` — Biome lint + format, writing fixes
- `bun run verify` — check + typecheck + test (what the pre-commit hook runs)
- `bun run smoke` — live API smoke test (needs `ANTHROPIC_API_KEY`; never in CI)

## Layout & dependency rules

`packages/{core,providers,tools,learning,repomap,tui,cli}`.

- **All shared contracts live in `@semideus/core`** (`src/contracts/`): `Tool`, `ToolResult`, `ModelSpec`, `DecisionEvent`, `AgentEvent`, `Concept`. Core imports **no** workspace package (only `ai`, `zod`, builtins).
- Every other package imports core. `cli` wires everything together. `tui` may only consume core events/types — never agent logic.
- Runtime is **Bun only** (`bun:sqlite`, `Bun.file`, `Bun.spawn`). Node compat is a non-goal until distribution hardening.

## Rules

- TypeScript strict; no `any` in exported APIs. Zod at every boundary; every tool-schema field has `.describe()` (descriptions are written for the model).
- Tools return `ToolResult` — they never throw; failures are `ok: false` with a message the model can act on.
- Every mutating tool calls `ctx.snapshot(path)` **before** touching the file.
- The permission gate is non-bypassable. Auto-accept is a policy setting that flows *through* the gate, never a code path around it.
- Model rationale is never presented as ground truth — always anchored to artifacts (`refs`, diffs, command output).
- Tests: `bun:test`, colocated. Every tool gets failure-path tests, not just happy paths.

## Docs

`docs/PLAN.md` — full product plan · `DEVELOPMENT.md` — way of working, phase gates · `docs/adr/` — decisions.

Current phase: **1** — all feature gates shipped (streaming, pre-approval diffs, Ink TUI, session picker + replay, context warnings, repo map, tool-mode fallbacks, esc-to-interrupt). Remaining: the exit criterion — demi as daily driver, a week of DOGFOOD.md entries. See DEVELOPMENT.md § Phase gates.
