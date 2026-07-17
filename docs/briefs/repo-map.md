# Brief: Repo map (phase-1 gate item)

Give demi a ranked, ~1k-token structural map of the repo in its system prompt, so it stops
guessing where things live. Design per PLAN §"repo map" (line ~219): parse with
`web-tree-sitter` (WASM), build a definition/reference graph, rank with personalized
PageRank, render the top slice under a token budget, cache in `.demi/cache/`. This is
Aider's proven design. ADR-0003 says the dependency lands with this feature — that's now.

## Constraints (non-negotiable)

- **Core stays dep-free.** `web-tree-sitter` must NOT be imported by `@semideus/core`.
  The map is computed outside core and handed to the session as a plain string — exactly
  the `projectMemory` (AGENTS.md) pattern: loaded in `cli/src/main.ts`, stored on
  `Session`, rendered in `core/src/prompt.ts`.
- **New workspace package `@semideus/repomap`** (`packages/repomap`), importing core only.
  `cli` wires it. Record this placement in a short **ADR-0005** (context → decision →
  consequences, ~15 lines), including where the grammar `.wasm` files come from.
- **No gate involvement.** The map is harness context assembly (like reading AGENTS.md),
  not an agent tool. It never prompts for permission and never mutates the workspace
  (`.demi/cache/` is already gitignored).
- **Graceful absence.** Any failure — grammar won't load, cache corrupt, parse error —
  degrades to "no repo map section in the prompt" plus a stderr warning. A broken map
  must never break a turn.
- **Tests colocated, failure paths mandatory** (bun:test). `bun run verify` green at
  every step. Conventional commits, one logical change each.

## Design decisions (already made — don't relitigate)

- **v1 languages: TS / TSX / JS only.** This repo is the dogfood target. Other grammars
  are a later ledger entry.
- **Graph is cached; ranking is per-prompt.** Cache file → `{mtimeMs, defs, refs}` per
  source file in `.demi/cache/repomap.json`; re-extract only files whose mtime changed.
  PageRank runs fresh each prompt build (it's cheap) so personalization can vary.
- **Personalization = files touched this session** (read/edited/mentioned). If the
  session has touched nothing yet, fall back to uniform personalization.
- **Token budget ≈ 1k, heuristic `chars/4`, budget configurable** (constant for now).
- **File discovery via `Bun.Glob`** over the workspace, skipping `node_modules`, `dist`,
  `coverage`, `.demi`, dotfiles. No new dep for walking.

## Steps — one per dogfood session, stop after each

**1. Spike + ADR.** Create `packages/repomap` scaffold. Add `web-tree-sitter` + a
prebuilt TS grammar (`.wasm` — vendor into the package or take an npm package that ships
it; whichever you pick, justify it in ADR-0005). Prove the risky part: parse one real
file from this repo under Bun, print the def/ref counts. A `spike.test.ts` asserting
parse output on a fixture string is the done-check. Write ADR-0005.

**2. Extractor.** `extract(path, source) → { defs: Symbol[], refs: Ref[] }` for
functions, classes, interfaces, type aliases, exported consts. Tests: a fixture file,
an empty file, a syntax-error file (→ `defs: []`, no throw).

**3. Graph + PageRank.** Pure TS, no tree-sitter import: build file-level graph
(file B references symbol defined in file A ⇒ edge B→A, weighted by ref count), then
personalized PageRank (damping 0.85, ~30 iterations). Tests on a hand-built toy graph:
known ranking order, personalization shifts the order, dangling nodes don't NaN.

**4. Renderer.** Ranked files → markdown: one section per file, its top defs as
signature lines, cut off at the token budget (never mid-file-section). Tests: respects
budget, skips unparsed files, deterministic order.

**5. Cache.** `loadCache`/`saveCache` + `buildRepoMap(cwd, opts)` tying 2–4 together
with mtime invalidation. Tests: unchanged mtimes → extractor not re-run; touched file →
re-extracted; corrupt JSON → full rebuild, no throw.

**6. Wire + close out.** `cli/src/main.ts` builds the map (async, before first turn) →
new `Session` field `repoMap: string` → `prompt.ts` renders `## Repo map` (after
Working rules, before AGENTS.md). Live check: `bun demi -p "which file implements the
permission gate?"` answers from the map without grepping. Then: tick the DEVELOPMENT.md
§7 checkbox, delete the "No repo map" honesty-ledger row, note cold vs warm build time
in the commit body.

## Done when

- `bun run verify` green; smoke test still green.
- Map for this repo renders under the budget and names the files that actually matter
  (`loop.ts`, `permissions.ts`, `session.ts`, tool files…).
- Second run in an unchanged repo hits the cache (visibly faster / extractor not called).
- Deleting `.demi/cache/` or the grammar wasm degrades gracefully: turn still works,
  prompt just lacks the section.

## Out of scope (v1)

Embeddings search · non-TS grammars · watch mode / incremental re-rank mid-session ·
compaction interplay (phase 3 keeps the map verbatim — noted in PLAN, nothing to do now).
