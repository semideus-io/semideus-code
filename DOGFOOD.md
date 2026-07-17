# DOGFOOD.md — friction journal

Every real task done with `demi` on this repo gets a line here. Friction entries are the
phase backlog — they outrank speculative features (DEVELOPMENT.md §8).

Format: `date · task · what ground · one-line fix idea`

---

- 2026-07-16 · **task 1/3** — audit README vs actual CLI surface (headless `-p`, sonnet; session `464824df`) · model reached for `bash` twice to cat/grep files it already had read-class tools for — denied both times and it adapted correctly (no verbatim retry), but interactively this would be approval-prompt spam that trains the user to hit "always" · system-prompt nudge: prefer read_file/grep/glob for inspection — bash costs an approval → **fixed 2026-07-17** (working rule in prompt.ts)
- 2026-07-16 · (same run) · 110k input tokens / ~$0.38 for a two-file audit — full history resent on every step, no prompt caching · wire Anthropic prompt caching in the provider layer → **fixed 2026-07-17** (cache middleware in providers, wire-verified; /cost prices reads at 0.1×, writes at 1.25×; note: prompts under the model's cacheable minimum — 4096 tok on haiku — never cache)
- 2026-07-16 · (same run) · intermediate assistant prose prints identically to the final answer, so the transcript reads disjointed mid-run · prefix or dim non-final assistant text in print.ts → **fixed 2026-07-17** (assistant-text events carry `final`; narration dims)

- 2026-07-16 · **task 2/3** — demi documents its own CLI surface in README (interactive REPL) · fat-fingered "a" at the write prompt — allow-session is invisible and irrevocable mid-session: no way to see or reset the live policy short of restarting · add `/permissions` to show + reset effective policy; consider a confirm step on "always" → **fixed 2026-07-17** (`/permissions` + `reset`; confirm step deferred — visibility + revocation felt sufficient)

- 2026-07-16 · **task 3/3** — boundary test for `truncateMiddle` in `/mode explain` (session `f1c5b74c`, resumed) · approved `edit_file` seeing only the intent line — the diff rendered *after* execution (honesty-ledger gap, now *felt*, not just listed) · confirms phase-1 priority: diff before approval in the TUI overlay
- 2026-07-16 · (same run) · bash output is never printed on success — had to take "all 7 tests pass" on faith, against the product's own anchor-claims-to-artifacts principle · print.ts: show tool-end output (tail ~10 lines) for execute-class tools → **fixed 2026-07-17**
- 2026-07-16 · (same run) · asked for the 48k cap, demi tested the boundary at `max=40` — same code path (the function is parameterized), defensible, but the substitution was silent, in explain mode of all places · prompt rule: narrate any deviation from the literal ask in one line → **fixed 2026-07-17** (working rule in prompt.ts)
- 2026-07-16 · (same run) · turn-end prints the session-cumulative total with no label — "$0.33" read as the cost of a 5-line test, but it was tasks 2+3 combined, with the resumed README history re-sent on every step · label it `turn X · session Y`; caching entry above is the real fix → **fixed 2026-07-17** (turn-end reports both; caching landed too)

---

**Phase 0 exit criterion met 2026-07-16** — three real tasks, eight friction lines. This list *is* the phase-1 backlog ordering.

**2026-07-17** — seven of eight entries fixed (commits `cb60653…9533589`). The one left open — diff rendered before approval — is the phase-1 TUI overlay itself.
