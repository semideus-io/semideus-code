# ADR-0002 — All shared contracts live in @semideus/core

**Status:** accepted · 2026-07-16

## Context

PLAN §6 sketches `ModelSpec` in `packages/providers` and `Tool` in `packages/tools`. But the core loop needs `Tool`, and tools need `ToolContext` from core — placing contracts in the leaf packages creates a dependency cycle (core ⇄ tools).

## Decision

Every cross-package type — `Tool`, `ToolResult`, `ToolContext`, `PermissionClass`, `ModelSpec`, `DecisionEvent`, `AgentEvent`, `Concept` — lives in `packages/core/src/contracts/`. Core imports no workspace package (only `ai`, `zod`, and Bun builtins). Every other package points at core; `cli` is the only package that imports everything.

## Consequences

- The dependency graph is a star with core at the center: no cycles, trivial to typecheck as one program.
- Deviation from the plan's file placement is intentional and this ADR is the record.
- Adding a contract means touching core — that friction is a feature: shared surface area stays deliberate.
