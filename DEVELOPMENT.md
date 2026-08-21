# DEVELOPMENT.md — how Semideus Code gets built

This is the working contract for the repo: the rules that don't change per session, the phase gates, and the checklists for common work. The *what and why* of the product live in [docs/PLAN.md](docs/PLAN.md); this file is the *how*.

## 1. Ground rules

These are the seven invariants. Everything else is negotiable per phase.

1. **The loop is the product.** The TUI is a renderer of `AgentEvent`s, never an owner of agent state. `@semideus/core` must never import `ink` or anything from `tui`. If a feature can't work headless, it isn't done.
2. **Contracts live in core.** Every shared type (`Tool`, `ToolResult`, `ModelSpec`, `DecisionEvent`, `AgentEvent`, `Concept`) sits in `packages/core/src/contracts/`. Core imports no workspace package; every other package imports core; only `cli` wires them together. (ADR-0002.)
3. **The permission gate is non-bypassable.** Every tool execution goes through `PermissionGate.check` — including your own dogfooding, including tests of the loop. `--yes` and "always this session" are policy values that flow *through* the gate; a code path around it is a bug by definition.
4. **Mutating tools snapshot first.** Any tool that changes a file calls `ctx.snapshot(path)` before touching it. That is what makes `/undo` trustworthy and what checkpoints v2 will build on.
5. **Rationale is never truth.** The model's stated why goes into `DecisionEvent.rationale`, always anchored to `refs` (files, commands, diffs). Any surface that shows rationale carries the disclaimer once per session. Never present rationale as introspection — it's the product's core epistemic promise.
6. **Config, not code.** Models, permissions, and limits come from `~/.config/daimon/config.toml` validated by Zod. Adding a model or a local endpoint must never require a code change.
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
| `bun daimon` | interactive TUI from source |
| `bun daimon -p "…"` | one-shot headless turn |
| `bun daimon sessions` / `resume [id]` | list / resume stored sessions |
| `bun test` | all tests (colocated `*.test.ts`, bun:test) |
| `bun run typecheck` | `tsc --noEmit` over the whole monorepo |
| `bun run check:fix` | Biome lint + format, writing fixes |
| `bun run verify` | check + typecheck + test — the commit gate |
| `bun run smoke` | one real API round-trip on `cheap` (needs key; never in CI) |

Optional: `cd packages/cli && bun link` to get a global `daimon` while developing.

## 3. Repo topology and dependency rules

```
cli ──► core, providers, tools, learning, repomap, tui   (wiring only)
tui ──► core                                             (events + types only)
tools, providers, learning, repomap ──► core
core ──► ai, zod, bun builtins                           (no workspace deps)
```

Where things go:

| You are adding… | It goes in… |
|---|---|
| a shared type or event | `core/src/contracts/` |
| loop / session / gate / store behavior | `core/src/` |
| a tool | `tools/src/<name>.ts` + registration in `tools/src/index.ts` |
| a provider or config field | `providers/src/` (schema in `config.ts`, construction in `factory.ts`) |
| anything learning (ledger, digest, recall, Semideus bridge) | `learning/src/` |
| repo-map / context building (parse, rank, render, cache) | `repomap/src/` |
| terminal rendering | `tui/src/` — headless printing stays in `cli/src/print.ts` |
| a slash command | `cli/src/commands.ts` — one implementation, every renderer |

## 4. Checklists

**Adding a tool** (the most common change):
1. Zod schema — every field `.describe()`d for the model, lenient where models are sloppy.
2. Pick the `PermissionClass` honestly (`read` / `write` / `execute` / `network`).
3. `summarize(input)` — one line, readable in an approval prompt.
4. `run()` returns `ToolResult`; it **never throws**. Failure messages tell the model what to do differently ("matches 3 locations — add context").
5. If it mutates: `ctx.snapshot(path)` before the mutation, refuse paths outside the workspace.
6. If approval needs more than the summary line (a diff, the full command): `preview()` — read-only, never throws, and sharing the plan/diff code with `run()` so the approved change is the applied change (ADR-0004).
7. Tests: happy path **and** every failure branch. Failure-path tests are not optional — the model reads these messages.
8. Register in `builtinTools`.

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
- Tags are **releases only** — `vX.Y.Z`, always cut by `bun run release`, never by hand. (The old `vX.Y.Z-phaseN` idea is dead: anything matching `v*` triggers the release workflow.) Phase completions are recorded in STATUS.md, not tags.

### Releasing

`git remote`: [github.com/semideus-io/semideus-code](https://github.com/semideus-io/semideus-code), public. `main` is branch-protected on the CI `verify` job. Releasing is mechanical: **push a tag, get a release** — `.github/workflows/release.yml` runs tag-version guard → verify → cross-compile (one ubuntu runner builds all four targets) → keyless binary checks on real ubuntu/macos/windows runners (windows `continue-on-error`: experimental) → GitHub Release with binaries + `SHA256SUMS` → npm publish. Order is a correctness constraint: the wrapper's postinstall downloads from the Release, so npm publishes last, and only from green. A failed tag publishes nothing.

To cut a version:

```bash
bun run release <patch|minor|major|X.Y.Z> [release notes…]
```

The script bumps `packages/cli/package.json` (the only version number that exists), runs the local pre-tag gate — `bun run verify`, `bun run build`, `--version` match from the compiled binary, and a **live smoke through the binary** (`-m cheap`, read-only, needs `ANTHROPIC_API_KEY`; `bun run smoke` stays out of CI per the standing rule) — then commits `release: vX.Y.Z` and creates the annotated tag. Gate red → bump reverted, nothing tagged. It never pushes; you do:

```bash
git push origin main vX.Y.Z
```

**npm auth is OIDC trusted publishing** — there is no `NPM_TOKEN` anywhere. One-time setup on npmjs.com (already-done checklist, kept for the day it needs redoing): package `@semideus/code` → Settings → Publishing access → *Trusted Publisher* → GitHub Actions, repository `semideus-io/semideus-code`, workflow `release.yml`. `npm publish --provenance` then authenticates via the workflow's OIDC token and publishes a provenance attestation linking the package to the exact commit and run that built it.

## 7. Phase gates

The rule from the plan, operationalized: **you must be dogfooding phase N daily before starting N+1.** Each phase has a definition of done; check items off in commits that complete them.

### Phase 0 — Skeleton (current)
- [x] Manual agent loop (`generateText`, schemas-only tools, max-steps cap)
- [x] Six tools with failure-path tests (`read_file`, `glob`, `grep`, `bash`, `write_file`, `edit_file` with unique-match + unified diff)
- [x] Non-bypassable permission gate (policy + interactive prompter + `--yes` as policy)
- [x] SQLite sessions, decision log, pre-mutation snapshots + `/undo`
- [x] `daimon` REPL + `daimon -p` one-shot + `sessions` / `resume`
- [x] `/why` (text), `/cost`, `/mode default|explain`
- [x] Anthropic provider + openai-compatible (local) via config TOML
- [x] Live smoke test green against the real API
- [x] **Exit criterion**: complete 3 real coding tasks in this repo with `daimon` itself and file the friction notes in `DOGFOOD.md` *(met 2026-07-16 — 3 tasks, 8 friction entries)*

### Phase 1 — Daily driver (weeks 2–4)
- [x] Ink TUI: `<Static>` transcript, streaming live region, approval overlay with the diff rendered *before* approval *(landed 2026-07-17 — ADR-0004; PTY-verified live: streamed turn, diff-first approval, deny honored)*
- [x] Streaming (`streamText`) in the loop, events unchanged *(landed 2026-07-17 — `assistant-delta` added for live regions; existing events untouched)*
- [x] Repo map: `web-tree-sitter` + personalized PageRank, ~1k-token budget, cached in `.daimon/cache/` *(landed 2026-07-17 — ADR-0005; 70 files, 90ms cold / 2ms warm, ~986 tok on this repo; live-checked: cheap model names gate/event files from the map, zero tool calls)*
- [x] Tool-mode fallback tiers (`json-fallback`, `xml-repair`) proven against one local model *(landed 2026-07-17 — protocol in the prompt, same executeCall/gate as native; json tier proven live on qwen2.5-coder:1.5b via Ollama, grounded answers from real tool runs; xml tier integration-tested, live proof waits on an XML-native model — ledger)*
- [x] Session picker for `resume`, context warnings at ~70% window *(landed 2026-07-17 — `resume --pick`, full transcript replay from stored messages, warn-once notice at 70% of the model window; PTY-verified)*
- [x] Esc interrupts the running turn; ctrl+c does the same headless *(landed 2026-07-18 — ADR-0006; AbortSignal through loop + ToolContext, partial text kept, unrun batch calls answered so stored history stays provider-valid, bash killed on abort; local usage mapping landed alongside so /cost and the 70% warning work on Ollama runs)*
- [x] **Exit criterion**: all six feature gates shipped and verified *(met 2026-07-23; the dogfooding-journal criterion was retired the same day — §8)*

### Phase 2 — The moat (weeks 5–8)
- [ ] `/why` panel in TUI, linked to artifacts; plan-first mode with approve/edit/reject
- [ ] `mentor` mode (TODO(you) gaps at decision points + diff review of the user's edit)
- [ ] Concept ledger extraction pass (`cheap` model) + `/digest`
- [ ] Built-in FSRS recall (`daimon review`)
- [ ] MCP client + Semideus Learn bridge (deposit cards, teach-back gate)
- [ ] `/onboard` generating `FOR-YOU.md`
- [ ] **Exit criterion**: your own review streak on coding-derived concepts ≥ 2 weeks

### Phase 3 — Hardening (weeks 9–12)
- [ ] Compaction (re-inject AGENTS.md after every compaction), shadow-git checkpoints, subagent task tool, headless CI mode
- [ ] Eval harness: all three tracks with first numbers
- [ ] `bun build --compile` matrix + npm wrapper publish of `@semideus/code`

## 8. How work gets proven

**Retired 2026-07-23: the dogfooding gate.** For two phases, progress was gated on a journal of daimon-driven sessions. It stopped paying: it required either paid cloud tokens per feature or a local model too small to implement anything, it stalled the repo for six days waiting on entries nobody could produce, and the friction it surfaced late was friction the implementing agent had already found early. `DOGFOOD.md` stays as a record of phases 0–1; it gates nothing. **Phases now turn on features shipped and verified.**

The working split, which is how every phase-1 feature actually landed:

**The implementing agent writes and proves.** No change ships on "tests pass" alone. Three levels, and the level is chosen by what the change touches:

1. **`bun run verify`** — check + typecheck + test. The floor, never the ceiling. Every tool keeps its failure-path tests.
2. **Behavioral proof** — the feature exercised the way a user meets it. TUI work gets a PTY run (streamed turn, overlay rendered, key honored); loop/provider/prompt work gets `bun run smoke` or a real local run; anything with a cache or a cost path gets checked on the wire, not inferred from code.
3. **Honest reporting** — what was verified and how, in the commit body. "Wire-tested request + response" and "integration-tested, live proof pending" are different claims and get written differently. Unproven is fine; unproven-and-presented-as-proven is not. The honesty ledger (§10) is where anything still owed goes.

**Giannis tests the experience.** Not correctness — that's the agent's job and it has the test suite. What a suite can't see: whether the flow makes sense, whether the output reads right, whether a surface earns its space. That feedback outranks speculative features exactly the way friction entries used to.

Two standing rules survive, unchanged and non-negotiable: never disable the permission gate to go faster (the habit you build is the product you ship), and never present model rationale as ground truth — anchor to artifacts, always.

## 9. Decision records

Anything that changes architecture, a dependency choice, or the product contract gets a short ADR in `docs/adr/` (context → decision → consequences, ~15 lines). Existing: 0001 stack, 0002 contracts-in-core, 0003 defer-heavy-deps. Superseded ADRs stay in place with a pointer to their successor.

## 10. Honesty ledger — known gaps, on purpose

| Gap | Why deferred | Lands |
|---|---|---|
| TUI input is append-only — no cursor keys, no history | hand-rolled input stays minimal until dogfood says what's actually missed | when it hurts |
| Repo map ranks uniformly at session start — no per-prompt personalization | needs a provider hook through core; uniform rank is already useful | when it hurts |
| `xml-repair` proven by tests, not live | qwen2.5-coder:1.5b won't emit XML (JSON-native); needs an XML-friendly local model on the bench | when one lands |
| `qwen3-coder:30b` on `native` intermittently leaks its tool call as prose | Observed 2026-07-23: identical prompt produced a real native call on one run and a raw `<function=bash>…` text block on the next. Ollama's template, not our loop — but on `native` the leaked call silently does nothing and the turn "concludes" having acted on nothing. The repair machinery already exists (`xml-repair`); what's missing is detecting a leaked call in `native` mode | next local-model pass |
| An interrupted step tracks no usage — /cost undercounts aborted turns | the provider reports nothing for a cut stream; unknowable client-side (ADR-0006) | accepted |
| `bash` snapshots nothing | can't know what a command touches; shadow-git checkpoints are the real answer | phase 3 |
| Messages stored as one JSON blob per session | fine at this scale; revisit if sessions grow or sync lands | when it hurts |
| Costs in config are estimates | pricing changes; config comments say so | ongoing |
| ~~No LICENSE yet~~ | Apache-2.0 landed 2026-08-20 with ADR-0010 (distribution shape) | closed |
| Release binaries unsigned | macOS notarization / Windows signing deferred; browser downloads will trip Gatekeeper — npm postinstall and curl mostly dodge it (ADR-0010) | when users hit it |
| ~~linux-x64 binary built but not run~~ | closed 2026-08-21: v0.1.0's `check-linux` job ran `--version` / `--help` / `sessions` on a real ubuntu runner, checksums verified — the Rosetta spin was emulation-only, as suspected | — |
