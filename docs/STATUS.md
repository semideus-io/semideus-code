# STATUS.md — where Semideus Code actually is

Plain-language snapshot, last checked **2026-07-23**. The *what and why* lives in
[PLAN.md](PLAN.md); the *how we work* lives in [../DEVELOPMENT.md](../DEVELOPMENT.md);
this file answers "if I sat down right now, what do I have?"

---

## 1. One paragraph

`demi` is a working terminal coding agent. You can run it against Claude or a local
Ollama model, chat with it in an Ink TUI or headless with `-p`, and it will read,
search, edit, and run things in your repo — but only after asking permission, and
showing you the exact diff or command *before* you say yes. Every session, every
decision, and every pre-edit file snapshot lands in SQLite, so you can resume, replay,
ask `/why`, and `/undo`. All of **phase 1's features are built**. The one thing left
in phase 1 is not code — it's proof: a week of actually using it daily.

## 2. What works today

| Area | State |
|---|---|
| **Agent loop** | Streaming (`streamText`), max-steps cap, tools never auto-execute — the loop is the only place intent becomes action |
| **Tools** | `read_file`, `glob`, `grep` (rg), `bash`, `write_file`, `edit_file` (unique-match + unified diff). Every one has failure-path tests |
| **Permission gate** | Non-bypassable. Every call goes through it. `--yes` and "always this session" are policy values *through* the gate, not around it |
| **Approval UX** | The diff / full command renders **before** you approve, in both the TUI overlay and headless prompt (ADR-0004) |
| **TUI** | Ink: `<Static>` transcript, live streaming region, approval overlay, spinner |
| **Interrupt** | `esc` in the TUI, `ctrl+c` headless — cuts the model mid-stream, kills running bash, keeps partial text, saves the session (ADR-0006) |
| **Sessions** | `bun:sqlite`. `demi sessions`, `resume`, `resume --pick` with full transcript replay |
| **Safety net** | Every mutating tool snapshots the file first → `/undo` is trustworthy |
| **Repo map** | tree-sitter + personalized PageRank, ~1k-token budget, cached in `.demi/cache/`. 70 files → 90 ms cold, 2 ms warm (ADR-0005) |
| **Providers** | Anthropic + any OpenAI-compatible endpoint (Ollama/LM Studio/vLLM), all from `~/.config/demi/config.toml` — adding a model is config, never code |
| **Weak-model support** | Tool-mode tiers: `native` → `json-fallback` → `xml-repair`. The json tier is proven live on qwen2.5-coder:1.5b |
| **Cost tracking** | Token + $ per turn and per session, with Anthropic prompt caching wired in (reads priced at 0.1×) |
| **Context warning** | Warn-once notice at 70% of the model's window |
| **Commands** | `/why` `/cost` `/undo` `/mode` `/session` `/permissions` `/help` `/exit` — one implementation, both renderers |

**Health check right now:** 162 tests pass across 23 files, `tsc --noEmit` clean,
~6,700 lines of source across 7 packages.

## 3. Phase 1 is closed

Turn interruption (ADR-0006) landed in `195d33f` on 2026-07-23 — the sixth and last
phase-1 feature gate. **Phase 2 (the moat) starts now.**

The dogfooding journal was retired the same day. It gated phases 0–1 and did real work
once — the eight phase-0 entries set phase 1's whole priority order — but it stopped
paying and had stalled the repo for six days. Phases now turn on features shipped and
verified; the implementing agent proves the work, Giannis tests the experience
(DEVELOPMENT.md §8).

## 4. What is *not* built yet

Everything in phase 2 (the moat) and phase 3 (hardening):

- **`/why` is text-only** — no navigable TUI panel linked to artifacts
- **No plan-first mode** — the agent doesn't propose a numbered plan for approval
- **No `mentor` mode** — the `TODO(you)` gaps + diff-review-of-your-edit loop
- **No concept ledger extraction** — `packages/learning/` is a ~20-line stub class.
  Nothing extracts concepts from diffs yet, so there's no `/digest`
- **No recall** — no SM-2 scheduler, no `demi review`
- **No MCP client** — no Semideus Learn bridge, no knowledge cards, no teach-back gate
- **No `/onboard`** / `FOR-YOU.md`
- **No compaction, shadow-git checkpoints, subagents, eval harness, or binaries**

In short: **the coding agent is real; the learning layer — the actual moat — is not
started.**

## 5. Known gaps we're keeping on purpose

Full table in [DEVELOPMENT.md §10](../DEVELOPMENT.md). The ones you'll feel first:

- TUI input is append-only — no cursor keys, no history
- Repo map ranks uniformly at session start, not per-prompt
- `xml-repair` is test-proven but not live-proven (needs an XML-native local model)
- `bash` snapshots nothing — shadow-git checkpoints in phase 3 are the real fix
- Interrupted steps report no token usage, so `/cost` undercounts aborted turns

## 6. The next step

**Phase 2, in build order.** Each item reads from data the loop already stores, so the
order is cheapest-first and each one is testable by eye:

1. **`/why` panel in the TUI** — navigable, linked to artifacts. `/why` is text-only
   today; the `DecisionEvent`s it needs are already logged. *(in progress)*
2. **Plan-first mode** — numbered plan with per-step rationale, approve/edit/reject
   before anything mutates. One prompt state + one overlay, reusing the approval path.
3. **`mentor` mode** — `TODO(you)` gaps at decision points, then a senior-engineer
   review of your diff. The deep one.
4. **Concept ledger + `/digest`** — a `cheap`-model pass over diffs and the decision log
   fills `packages/learning/`, which is a stub today.
5. **Built-in recall** — SM-2 over the ledger, `demi review`.
6. **MCP client + Semideus Learn bridge** — concepts become knowledge cards; teach-back
   gates big merges. The unfair advantage nobody else can copy.

Then `/onboard` + `FOR-YOU.md`. Phase-2 exit: a review streak on coding-derived
concepts ≥ 2 weeks.

**First phase-2 feature when the gate opens:** the `/why` TUI panel + plan-first mode.
Reason to start there rather than the ledger: both read from `DecisionEvent`s that
already exist, both are UI over data we're already storing, and both directly improve
the dogfooding loop that's currently blocking us — plan-first cuts wasted turns on a
cheap model, and `/why` is the surface DEVELOPMENT.md §8 says to check first when demi
surprises you. The concept ledger comes after, because it needs a new extraction pass
and a `cheap`-model round-trip per turn.
