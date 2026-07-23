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

## 3. What's sitting uncommitted in the working tree

The **turn-interruption feature** (ADR-0006) plus its docs — 16 modified files, ~300
added lines. It's finished and verified (tests + typecheck green), just not committed.
This is the last phase-1 feature; committing it closes the feature list.

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

**Immediately:** commit the interruption work in the tree. It's done and green.

**Then the phase-1 gate:** the rule is *dogfood phase N daily before starting N+1*
(DEVELOPMENT.md §7). The exit criterion is `demi` as the default agent on this repo
with a week of [DOGFOOD.md](../DOGFOOD.md) entries. Constraint we already learned the
hard way (2026-07-17): building features at cloud `default` prices burns paid tokens
fast enough to stop the session — so dogfood runs go to `cheap`/local, and heavy
implementation stays with another agent. Friction entries from that week outrank any
speculative feature and become the phase-2 backlog ordering.

**First phase-2 feature when the gate opens:** the `/why` TUI panel + plan-first mode.
Reason to start there rather than the ledger: both read from `DecisionEvent`s that
already exist, both are UI over data we're already storing, and both directly improve
the dogfooding loop that's currently blocking us — plan-first cuts wasted turns on a
cheap model, and `/why` is the surface DEVELOPMENT.md §8 says to check first when demi
surprises you. The concept ledger comes after, because it needs a new extraction pass
and a `cheap`-model round-trip per turn.
