# ADR-0005 — Repo map lives in its own package; grammars come prebuilt from npm

**Status:** accepted · 2026-07-17

## Context

The repo map (PLAN, phase 1) needs `web-tree-sitter`, but core imports no
workspace package and no heavy deps (ADR-0002), and cli is wiring-only. The
grammar `.wasm` binaries have to come from somewhere: vendored into the repo,
built with tree-sitter-cli (needs emscripten), or prebuilt off npm.

## Decision

- New workspace package **`@semideus/repomap`**, importing core only. cli calls
  it and hands the rendered map to `Session` as a plain string — the exact
  `projectMemory` (AGENTS.md) pattern, so core stays dep-free.
- Grammars come from **`tree-sitter-wasms`** (prebuilt, 36 languages), resolved
  at runtime with `import.meta.resolve` from repomap's own node_modules — no
  binaries in git, works under Bun's isolated linker. v1 loads `typescript`
  and `tsx` only (`.ts/.js` → typescript, `.tsx/.jsx` → tsx).
- The map string is built once at session start with uniform PageRank
  personalization. Per-prompt personalization (rank toward session-touched
  files) needs a provider hook through core — deferred to the honesty ledger.

## Consequences

- Dependency rules table gains one row: `repomap → core`. Spike-verified under
  Bun 1.3: `Parser.init()` + `Language.load(bytes)`, parse failures are ERROR
  nodes (never throws), broken grammars degrade to "no map" by design.
- Grammar coverage beyond TS/JS is one `GRAMMAR_BY_EXT` entry + the wasm the
  package already ships.
