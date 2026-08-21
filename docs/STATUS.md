# STATUS.md — where Semideus Code actually is

Plain-language snapshot, last checked **2026-08-20**. The *what and why* lives in
[PLAN.md](PLAN.md); the *how we work* lives in [../DEVELOPMENT.md](../DEVELOPMENT.md);
this file answers "if I sat down right now, what do I have?"

---

## 1. One paragraph

`daimon` is a working terminal coding agent. You can run it against Claude or a local
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
| **Sessions** | `bun:sqlite`. `daimon sessions`, `resume`, `resume --pick` with full transcript replay |
| **Safety net** | Every mutating tool snapshots the file first → `/undo` is trustworthy |
| **Repo map** | tree-sitter + personalized PageRank, ~1k-token budget, cached in `.daimon/cache/`. 70 files → 90 ms cold, 2 ms warm (ADR-0005) |
| **Providers** | Anthropic + any OpenAI-compatible endpoint (Ollama/LM Studio/vLLM), all from `~/.config/daimon/config.toml` — adding a model is config, never code |
| **Weak-model support** | Tool-mode tiers: `native` → `json-fallback` → `xml-repair`. The json tier is proven live on qwen2.5-coder:1.5b |
| **Cost tracking** | Token + $ per turn and per session, with Anthropic prompt caching wired in (reads priced at 0.1×) |
| **Context warning** | Warn-once notice at 70% of the model's window |
| **Commands** | `/why` `/cost` `/undo` `/mode` `/session` `/permissions` `/help` `/exit` — one implementation, both renderers |
| **Packaging** | `bun run build` → 4 self-contained binaries (wasm embedded, no node_modules at runtime) + SHA256SUMS; `bun run build:npm` → checksum-pinned `@semideus/code` wrapper. Apache-2.0, ADR-0010. Proven live 2026-08-20 |
| **Published** | [github.com/semideus-io/semideus-code](https://github.com/semideus-io/semideus-code), public, branch-protected on CI. **v0.1.0 released 2026-08-21**: tag-triggered pipeline (guard → verify → cross-compile → per-OS checks incl. real-ubuntu linux-x64 → GitHub Release). `curl \| sh` installer proven against the live release. npm publish is wired (OIDC) but awaiting the one-time trusted-publisher setup on npmjs.com |

**Health check right now:** 194 tests pass across 27 files, `tsc --noEmit` clean,
~7,000 lines of source across 7 packages.

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
- **No recall** — no SM-2 scheduler, no `daimon review`
- **No MCP client** — no Semideus Learn bridge, no knowledge cards, no teach-back gate
- **No `/onboard`** / `FOR-YOU.md`
- **No compaction, shadow-git checkpoints, subagents, or eval harness** (binaries
  landed 2026-08-20 — [briefs/packaging.md](briefs/packaging.md) is done;
  [briefs/release-pipeline.md](briefs/release-pipeline.md) shipped v0.1.0 on
  2026-08-21 — only the npm trusted-publisher click remains)

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

**Phase 2, in build order.** Each remaining feature has a spec in `briefs/` —
constraints, decisions already made, stepped plan, and verification criteria:

1. ~~**`/why` panel in the TUI**~~ — landed `dfe6a15` (2026-07-23), navigable, linked
   to artifacts.
2. **Plan-first mode** — [briefs/plan-first.md](briefs/plan-first.md). Numbered plan
   approved through the gate before anything mutates; completes checkbox 1.
3. **`mentor` mode** — [briefs/mentor-mode.md](briefs/mentor-mode.md). `TODO(you)`
   gaps at decision points, then `/review` of your actual diff.
4. **Concept ledger + `/digest`** — [briefs/concept-ledger.md](briefs/concept-ledger.md).
   `cheap`-model extraction over the decision log fills `packages/learning/`.
5. **Built-in recall** — [briefs/recall.md](briefs/recall.md). FSRS (via `ts-fsrs`)
   over the ledger, `daimon review`, streak tracking (the phase-exit instrument).
6. **MCP client + Semideus Learn bridge** —
   [briefs/semideus-bridge.md](briefs/semideus-bridge.md). Concepts become knowledge
   cards; teach-back via the Learn server. The unfair advantage nobody else can copy.
7. **`/onboard` + `FOR-YOU.md`** — [briefs/onboard.md](briefs/onboard.md). Closes the
   phase's feature list.

Phase-2 exit: a review streak on coding-derived concepts ≥ 2 weeks — the clock starts
when `daimon review` (item 5) lands.

The order is dependency-honest and cheapest-first: plan-first reuses the existing
approval path; mentor is prompt + a small turn-end hook; the ledger needs the first
`cheap`-model pass; recall reads the ledger; the bridge deposits from it; `/onboard`
composes everything.
