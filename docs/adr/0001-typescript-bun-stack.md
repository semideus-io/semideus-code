# ADR-0001 — TypeScript on Bun, Ink, AI SDK, bun:sqlite

**Status:** accepted · 2026-07-16

## Context

A solo-built terminal coding agent needs maximum iteration speed on UX and model fluency, single-binary distribution, and an extension ecosystem (MCP) that is TypeScript-first. The security-hardening argument for a Rust core left with the decision to pursue security tooling as a separate future project.

## Decision

TypeScript (strict) on Bun ≥ 1.3. Ink for the TUI (phase 1). Vercel AI SDK behind our own `ModelSpec` interface. Zod everywhere a boundary exists. `bun:sqlite` for sessions/decisions/concepts. Biome + `bun test`. Distribution via `bun build --compile` per platform plus a thin npm wrapper.

Full argument: [docs/PLAN.md §1–2](../PLAN.md).

## Consequences

- Models are maximally fluent in the repo's own language — the tool helps build itself from phase 1.
- Bun-only runtime assumptions (`bun:sqlite`, `Bun.spawn`, `Bun.file`) are allowed everywhere; Node compat is explicitly deferred to distribution hardening.
- Escape hatch stays open: provider/tool/permission/storage boundaries are interfaces, so a hot path can move to Rust via napi-rs without touching the rest.
- We track the AI SDK's major-version cadence (scaffolded on v7; plan §6–7 was written against v5-era names — the shapes were re-verified against installed types, see loop.ts).
