# DEVELOPMENT.md — how Semideus Code gets built

This is the working contract for the repo: the rules that don't change per session, the phase gates, and the checklists for common work. The *what and why* of the product live in [docs/PLAN.md](docs/PLAN.md); this file is the *how*.

## 1. Ground rules

These are the seven invariants. Everything else is negotiable per phase.

1. **The loop is the product.** The TUI is a renderer of `AgentEvent`s, never an owner of agent state. `@semideus/core` must never import `ink` or anything from `tui`. If a feature can't work headless, it isn't done.
2. **Contracts live in core.** Every shared type (`Tool`, `ToolResult`, `ModelSpec`, `DecisionEvent`, `AgentEvent`, `Concept`) sits in `packages/core/src/contracts/`. Core imports no workspace package; every other package imports core; only `cli` wires them together. (ADR-0002.)
3. **The permission gate is non-bypassable.** Every tool execution goes through `PermissionGate.check` — including your own dogfooding, including tests of the loop. `--yes` and "always this session" are policy values that flow *through* the gate; a code path around it is a bug by definition.
4. **Mutating tools snapshot first.** Any tool that changes a file calls `ctx.snapshot(path)` before touching it. That is what makes `/undo` trustworthy and what checkpoints v2 will build on.
5. **Rationale is never truth.** The model's stated why goes into `DecisionEvent.rationale`, always anchored to `refs` (files, commands, diffs). Any surface that shows rationale carries the disclaimer once per session. Never present rationale as introspection — it's the product's core epistemic promise.
6. **Config, not code.** Models, permissions, and limits come from `~/.config/demi/config.toml` validated by Zod. Adding a model or a local endpoint must never require a code change.
7. **Stay on-distribution.** Models write most of this codebase. Small files, boring idioms, explicit types at boundaries, tool schemas with `.describe()` on every field. Cleverness costs more than it earns here.

## 2. Environment & daily commands

Setup once: install [Bun](https://bun.sh) and ripgrep (`brew install ripgrep`), then:

```bash
bun install
git config core.hooksPath .githooks   # pre-commit runs the same gate as CI
export ANTHROPIC_API_KEY=sk-ant-…
```

| Command | What it does |
|---|---|
| `bun demi` | REPL from source |
| `bun demi -p "…"` | one-shot headless turn |
| `bun demi sessions` / `resume [id]` | list / resume stored sessions |
| `bun test` | all tests (colocated `*.test.ts`, bun:test) |
| `bun run typecheck` | `tsc --noEmit` over the whole monorepo |
| `bun run check:fix` | Biome lint + format, writing fixes |
| `bun run verify` | check + typecheck + test — the commit gate |
| `bun run smoke` | one real API round-trip on `cheap` (needs key; never in CI) |

Optional: `cd packages/cli && bun link` to get a global `demi` while developing.

## 3. Repo topology and dependency rules

```
cli ──► core, providers, tools, learning, tui   (wiring only)
tui ──► core                                    (events + types only)
tools, providers, learning ──► core
core ──► ai, zod, bun builtins                  (no workspace deps)
```

Where things go:

| You are adding… | It goes in… |
|---|---|
| a shared type or event | `core/src/contracts/` |
| loop / session / gate / store behavior | `core/src/` |
| a tool | `tools/src/<name>.ts` + registration in `tools/src/index.ts` |
| a provider or config field | `providers/src/` (schema in `config.ts`, construction in `factory.ts`) |
| anything learning (ledger, digest, recall, Semideus bridge) | `learning/src/` |
| terminal rendering | `tui/src/` (phase 1+) — REPL printing stays in `cli/src/print.ts` until then |
| a slash command | `cli/src/main.ts` (REPL switch) — and later its TUI equivalent |

## 4. Checklists

**Adding a tool** (the most common change):
1. Zod schema — every field `.describe()`d for the model, lenient where models are sloppy.
2. Pick the `PermissionClass` honestly (`read` / `write` / `execute` / `network`).
3. `summarize(input)` — one line, readable in an approval prompt.
4. `run()` returns `ToolResult`; it **never throws**. Failure messages tell the model what to do differently ("matches 3 locations — add context").
5. If it mutates: `ctx.snapshot(path)` before the mutation, refuse paths outside the workspace.
6. Tests: happy path **and** every failure branch. Failure-path tests are not optional — the model reads these messages.
7. Register in `builtinTools`.

**Adding a provider**: extend `modelConfigSchema` → handle in `buildModelSpec` → add a `[models.x]` example to `DEFAULT_CONFIG_TOML` → config test.

**Adding a mode**: overlay text in `core/src/prompt.ts` `MODE_OVERLAYS` + REPL `/mode` validation. Modes are prompt overlays plus *small* loop behaviors — if a mode needs loop surgery, stop and write an ADR first.

## 5. Testing strategy

- **Unit**: every tool (failure paths mandatory), gate, store, text utils. Colocated `*.test.ts`.
- **Integration**: the loop against `MockLanguageModelV3` from `ai/test` — scripted tool-call → result → conclusion turns. This is where loop invariants live: message shapes, decision log, denial flow, no duplicate tool results.
- **Live smoke**: `bun run smoke` — one real `cheap`-model round-trip through the full stack. Run it after touching loop/providers/prompt. Key-gated, read-only policy, never in CI.
- **Environment-dependent tests** (`rg`): `test.skipIf(...)`, and CI installs the dependency so they run there.
- **Eval harness (phase 3)**: three tracks per PLAN §13 — capability (≈20 terminal tasks, headless, CI), learning outcome (comprehension delta default vs mentor), retention (7/30-day review success). Even n=10 numbers are the launch story; nothing ships to "later" without a date.

## 6. Git, commits, CI

- Trunk-based on `main`; short-lived branches only when an experiment might be thrown away.
- Conventional commits: `feat(tools): …`, `fix(core): …`, `docs: …`, `test: …`, `chore: …`, `refactor: …`.
- Small commits — one logical change each. The decision log philosophy applies to you too: a commit message states the what, the body states the why when it isn't obvious.
- `.githooks/pre-commit` runs `bun run verify`; CI (`.github/workflows/ci.yml`) runs the identical gate on Ubuntu. `--no-verify` is for emergencies, and an emergency is followed by a fix commit.
- Tag phase completions: `v0.1.0-phase0`, `v0.2.0-phase1`, …

## 7. Phase gates

The rule from the plan, operationalized: **you must be dogfooding phase N daily before starting N+1.** Each phase has a definition of done; check items off in commits that complete them.

### Phase 0 — Skeleton (current)
- [x] Manual agent loop (`generateText`, schemas-only tools, max-steps cap)
- [x] Six tools with failure-path tests (`read_file`, `glob`, `grep`, `bash`, `write_file`, `edit_file` with unique-match + unified diff)
- [x] Non-bypassable permission gate (policy + interactive prompter + `--yes` as policy)
- [x] SQLite sessions, decision log, pre-mutation snapshots + `/undo`
- [x] `demi` REPL + `demi -p` one-shot + `sessions` / `resume`
- [x] `/why` (text), `/cost`, `/mode default|explain`
- [x] Anthropic provider + openai-compatible (local) via config TOML
- [x] Live smoke test green against the real API
- [ ] **Exit criterion**: complete 3 real coding tasks in this repo with `demi` itself and file the friction notes in `DOGFOOD.md`

### Phase 1 — Daily driver (weeks 2–4)
- [ ] Ink TUI: `<Static>` transcript, streaming live region, approval overlay with the diff rendered *before* approval (today approval shows the intent, diff after — known gap)
- [ ] Streaming (`streamText`) in the loop, events unchanged
- [ ] Repo map: `web-tree-sitter` + personalized PageRank, ~1k-token budget, cached in `.demi/cache/` (dependency added when the feature lands — ADR-0003)
- [ ] Tool-mode fallback tiers (`json-fallback`, `xml-repair`) proven against one local model
- [ ] Session picker for `resume`, context warnings at ~70% window
- [ ] **Exit criterion**: demi is your default agent for this repo; a week of DOGFOOD.md entries

### Phase 2 — The moat (weeks 5–8)
- [ ] `/why` panel in TUI, linked to artifacts; plan-first mode with approve/edit/reject
- [ ] `mentor` mode (TODO(you) gaps at decision points + diff review of the user's edit)
- [ ] Concept ledger extraction pass (`cheap` model) + `/digest`
- [ ] Built-in SM-2 recall (`demi review`)
- [ ] MCP client + Semideus Learn bridge (deposit cards, teach-back gate)
- [ ] `/onboard` generating `FOR-YOU.md`
- [ ] **Exit criterion**: your own review streak on coding-derived concepts ≥ 2 weeks

### Phase 3 — Hardening (weeks 9–12)
- [ ] Compaction (re-inject AGENTS.md after every compaction), shadow-git checkpoints, subagent task tool, headless CI mode
- [ ] Eval harness: all three tracks with first numbers
- [ ] `bun build --compile` matrix + npm wrapper publish of `@semideus/code`

## 8. Dogfooding protocol

From now on, work on this repo starts inside `demi` (fall back to other agents only when demi itself is what's broken). Keep `DOGFOOD.md` in the repo root: date, task, what ground, one-line fix idea. Friction entries are the phase backlog — they outrank speculative features. Two standing rules: never disable the gate to go faster (the habit you build is the product you ship), and when demi surprises you, check `/why` first — that surface is the moat, and it has to earn its keep on you before anyone else.

## 9. Decision records

Anything that changes architecture, a dependency choice, or the product contract gets a short ADR in `docs/adr/` (context → decision → consequences, ~15 lines). Existing: 0001 stack, 0002 contracts-in-core, 0003 defer-heavy-deps. Superseded ADRs stay in place with a pointer to their successor.

## 10. Honesty ledger — known gaps, on purpose

| Gap | Why deferred | Lands |
|---|---|---|
| Approval shows intent, not the diff | diff is computed inside `run()`; restructuring for pre-approval diffs belongs with the TUI overlay | phase 1 |
| No streaming | `generateText` keeps the loop trivially testable; events already support it | phase 1 |
| `json-fallback` / `xml-repair` accepted in config but not implemented | needs a local model on the bench to test against for real | phase 1 |
| No repo map | biggest context feature, deserves its own focused build | phase 1 |
| `bash` snapshots nothing | can't know what a command touches; shadow-git checkpoints are the real answer | phase 3 |
| Messages stored as one JSON blob per session | fine at this scale; revisit if sessions grow or sync lands | when it hurts |
| Costs in config are estimates | pricing changes; config comments say so | ongoing |
| No LICENSE yet | decide before publishing `@semideus/code` | phase 3 |
