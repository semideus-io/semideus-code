# DOGFOOD.md — friction journal *(closed 2026-07-23)*

> **Archived.** This journal gated phases 0 and 1. It no longer gates anything —
> phases now turn on features shipped and verified (DEVELOPMENT.md §8). It did its
> job once: the eight phase-0 entries below set phase 1's entire priority order, and
> all eight were fixed. It stopped paying after that, because the implementing agent
> was finding the same friction earlier and cheaper. Kept as a record, not a process.
>
> Format was: `date · task · what ground · one-line fix idea`

---

- 2026-07-16 · **task 1/3** — audit README vs actual CLI surface (headless `-p`, sonnet; session `464824df`) · model reached for `bash` twice to cat/grep files it already had read-class tools for — denied both times and it adapted correctly (no verbatim retry), but interactively this would be approval-prompt spam that trains the user to hit "always" · system-prompt nudge: prefer read_file/grep/glob for inspection — bash costs an approval → **fixed 2026-07-17** (working rule in prompt.ts)
- 2026-07-16 · (same run) · 110k input tokens / ~$0.38 for a two-file audit — full history resent on every step, no prompt caching · wire Anthropic prompt caching in the provider layer → **fixed 2026-07-17** (cache middleware in providers, wire-verified; /cost prices reads at 0.1×, writes at 1.25×; note: prompts under the model's cacheable minimum — 4096 tok on haiku — never cache)
- 2026-07-16 · (same run) · intermediate assistant prose prints identically to the final answer, so the transcript reads disjointed mid-run · prefix or dim non-final assistant text in print.ts → **fixed 2026-07-17** (assistant-text events carry `final`; narration dims)

- 2026-07-16 · **task 2/3** — demi documents its own CLI surface in README (interactive REPL) · fat-fingered "a" at the write prompt — allow-session is invisible and irrevocable mid-session: no way to see or reset the live policy short of restarting · add `/permissions` to show + reset effective policy; consider a confirm step on "always" → **fixed 2026-07-17** (`/permissions` + `reset`; confirm step deferred — visibility + revocation felt sufficient)

- 2026-07-16 · **task 3/3** — boundary test for `truncateMiddle` in `/mode explain` (session `f1c5b74c`, resumed) · approved `edit_file` seeing only the intent line — the diff rendered *after* execution (honesty-ledger gap, now *felt*, not just listed) · confirms phase-1 priority: diff before approval in the TUI overlay → **fixed 2026-07-17** (tools compute a read-only preview pre-approval; the TUI overlay and the headless prompter both render the diff/full command before y/a/N — ADR-0004)
- 2026-07-16 · (same run) · bash output is never printed on success — had to take "all 7 tests pass" on faith, against the product's own anchor-claims-to-artifacts principle · print.ts: show tool-end output (tail ~10 lines) for execute-class tools → **fixed 2026-07-17**
- 2026-07-16 · (same run) · asked for the 48k cap, demi tested the boundary at `max=40` — same code path (the function is parameterized), defensible, but the substitution was silent, in explain mode of all places · prompt rule: narrate any deviation from the literal ask in one line → **fixed 2026-07-17** (working rule in prompt.ts)
- 2026-07-16 · (same run) · turn-end prints the session-cumulative total with no label — "$0.33" read as the cost of a 5-line test, but it was tasks 2+3 combined, with the resumed README history re-sent on every step · label it `turn X · session Y`; caching entry above is the real fix → **fixed 2026-07-17** (turn-end reports both; caching landed too)

---

**Phase 0 exit criterion met 2026-07-16** — three real tasks, eight friction lines. This list *is* the phase-1 backlog ordering.

**2026-07-17** — seven of eight entries fixed (commits `cb60653…9533589`). The one left open — diff rendered before approval — is the phase-1 TUI overlay itself.

**2026-07-17 (later)** — the eighth entry closed with the TUI build: streaming loop, pre-approval previews, Ink app (Static transcript · live region · approval overlay), TUI as the interactive surface. The phase-0 friction list is fully burned down; the next list starts from daily-driving the TUI.

---

- 2026-07-17 · **first TUI dogfood: session-picker scaffold** (interactive session) · building a real feature over the metered cloud API burns paid tokens fast enough to stop the session — dogfooding the daily driver at cloud `default` prices is not sustainable solo · route dogfood sessions to `cheap` by default and land the tool-mode fallbacks so a local model can carry them
- 2026-07-17 · (same run) · the session ended with the scaffold uncommitted and test-less, and review caught a real bug in it: replay mapped tools to `tool-end` only, which renders *nothing* for successful read-class tools — replayed history would have been mostly invisible · prompt rule candidate: a feature isn't done without colocated tests and a green `bun run verify`; finished + verified via Claude Code (commits above), which is the fallback protocol working as intended
- 2026-07-17 · **fallback-tier proof** (headless `-p`, local qwen2.5-coder:1.5b via Ollama) · json tier worked twice, grounded answers from real tool runs — but `/cost` printed `0 in → 0 out` (Ollama usage not mapped), and in xml mode the model ignored the protocol three ways, once *fabricating a tool result it never ran* · map compat usage through in providers; xml tier needs an XML-native model — both on the ledger → **usage mapping fixed 2026-07-18** (compat streams request usage via `include_usage`; wire-tested request + response, so /cost and the 70% context warning now see local tokens; the xml-native model stays on the ledger)
