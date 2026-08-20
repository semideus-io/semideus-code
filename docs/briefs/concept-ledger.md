# Brief: Concept ledger + /digest (phase-2 gate item, build order 3)

The first feature that makes the moat real: a `cheap`-model pass over the session's
decision log and diffs extracts the concepts the user actually met — APIs, patterns,
pitfalls, domain ideas — grounded in their own code, into SQLite. `/digest` renders the
session's haul ("today you touched: Zod refinements (new), N+1 pitfall (2×)…") with
jump-refs to where each appeared. PLAN §10.4. Everything downstream — recall, the
Semideus bridge, telemetry — reads from this ledger, so shapes matter more than polish.

## Constraints (non-negotiable)

- **Input is DecisionEvents + artifacts, never the raw chat.** The extraction pass reads
  summaries, rationales, refs, diffs, and command output from the decision log — the
  glass-box spine. If a concept can't cite a ref from the session, it's dropped.
- **Dependency rules hold**: `learning` imports core only. The extractor takes a
  `ModelSpec` (core contract); `cli` resolves the `cheap` model from config and hands it
  in. No provider imports in `learning`.
- **Graceful absence.** No `cheap` model configured, no key, extraction call fails,
  output unparseable → `/digest` says exactly that and the session is otherwise
  untouched. A broken ledger must never break a turn.
- **Zod at the boundary, lenient where models are sloppy** — extraction output is
  model-generated JSON; salvage what validates, drop what doesn't, never throw.
- **Cost is visible.** The extraction pass reports its tokens/$ into session usage like
  any other model call; the commit body states the measured cost of one real extraction.
- Tests colocated, failure paths mandatory. `bun run verify` green at every step.

## Design decisions (already made — don't relitigate)

- **Extraction runs on demand and at session end, not per turn.** `/digest` triggers it;
  a clean `/exit` triggers it (skippable, and skipped when the session logged no
  mutating decision). Per-turn passes are a cost decision to revisit with data.
- **The `Concept` contract is already in core** (`slug`, `name`, `kind:
  api|pattern|pitfall|domain`, `example`, `firstSeen`, `occurrences`) and the store
  already has `upsertConcept`/`concepts()`. The stub `ConceptLedger` grows the logic:
  upsert by slug — new slug inserts with `occurrences: 1`, known slug increments and
  keeps the *first* example (the encounter that taught it).
- **The extraction prompt is the craftsmanship point.** It gets: the session's decision
  log (capped: newest N events, diffs/output truncated as stored) and instructions to
  return strict JSON `{ concepts: [...] }` — max ~7 per session, each with a one-line
  `example` quoting or citing actual session code (`path:line` or a diff hunk), kinds
  chosen honestly, slugs kebab-case and stable ("zod-refinements", not "zod-1").
- **`extractConcepts(events, model): Promise<Concept[]>`** in `learning/src/extract.ts`,
  pure enough to test with `MockLanguageModelV3`. `/digest` = extract → ledger upsert →
  render (new vs reinforced, kind-tagged, refs printed as `path:line`).
- **Renderer-agnostic like every command**: `/digest` returns lines through
  `runCommand`, so TUI and headless share it.

## Steps

**1. Extraction core.** Prompt builder + Zod response schema + lenient parse. Tests on
fixture decision logs: happy path, JSON in a code fence, partial garbage (valid entries
salvaged), pure garbage (→ `[]`), events-without-artifacts (→ few/no concepts, no
invention).

**2. Model call.** `extractConcepts` against `MockLanguageModelV3`; usage accounted into
the session totals. Tests: usage recorded, failure → empty result + notice, never throw.

**3. Ledger semantics.** Upsert/occurrence/first-example rules in `ConceptLedger`.
Tests: new vs repeat slug, occurrence counts, example stability.

**4. `/digest` + session-end hook.** Command rendering (new vs reinforced), wiring in
`cli` (resolve `cheap` → hand `ModelSpec` to learning), end-of-session trigger with the
no-mutations skip. Tests: rendering fixtures, no-cheap-model path.

**5. Prove.** Live: one real daimon session on this repo (a small true task), then
`/digest` on the `cheap` model. Judge: are the concepts real, grounded, would-you-review
them? Report the extraction's measured cost. Tick the §7 checkbox.

## Done when (verification criteria)

- `bun run verify` green; smoke green.
- Mock-model integration: a scripted session yields stored concepts; a second identical
  session increments `occurrences` instead of duplicating.
- Every stored concept's `example` cites session code — asserted in tests (refs
  non-empty) and eyeballed live.
- Live `/digest` on this repo reads right (Giannis-judged) and its cost lands in
  `/cost`; with no `cheap` model configured it degrades to a one-line notice.

## Out of scope (v1)

Per-turn extraction · concept merging/aliasing across near-duplicate slugs · editing or
deleting concepts from the TUI · cross-session dedup beyond slug upsert · SM-2 fields
(next brief) · any Semideus Learn traffic (bridge brief).
