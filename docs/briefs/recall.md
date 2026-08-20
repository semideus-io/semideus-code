# Brief: Built-in recall — FSRS + `daimon review` (phase-2 gate item, build order 4)

Close the loop standalone: an FSRS scheduler over the concept ledger and a `daimon review`
subcommand that runs a ~3-minute terminal review of due concepts. PLAN §10.5 (the
"built-in" half — the Semideus bridge is its own brief). FSRS over SM-2 is deliberate:
it models memory as difficulty/stability/retrievability and schedules to a target
retention, giving the same retention on ~20–30% fewer reviews — and fewer, better-timed
reviews is exactly what a 2-week streak criterion needs to survive contact with a busy
week. This brief is also the phase-2 exit criterion's instrument: the streak must be
recorded and queryable, so that lands here too.

## Constraints (non-negotiable)

- **Headless-first.** `daimon review` is plain stdin/stdout (readline), no Ink. If a
  feature can't work headless it isn't done — and a review must be runnable over ssh on
  a bad day, because streaks die on friction.
- **No model calls, zero network.** v1 review is show → recall → grade. Scheduling is
  pure local math. Model-graded recall is the teach-back gate (bridge brief).
- **The `Concept` contract stays clean.** Scheduling state is storage-layer, not a
  contract change — recall state lives beside concepts, keyed by slug.
- **The dependency gets an ADR.** `ts-fsrs` lands with this feature (the ADR-0003
  pattern) as **ADR-0008**: why FSRS over SM-2, why the package over hand-rolling
  ~20 fitted parameters, and the swap boundary (below). Only `learning` imports it;
  core stays dep-free.
- Tests colocated, failure paths mandatory. `bun run verify` green at every step.

## Design decisions (already made — don't relitigate)

- **FSRS via `ts-fsrs`**, default FSRS-6 parameters, target retention **0.9**. No
  per-user parameter optimization in v1 — optimization needs months of review history
  that doesn't exist yet (ledgered for later, with the review log as its future input).
- **Four grades, Anki-style: Again / Hard / Good / Easy** (keys `1`–`4`). This replaces
  SM-2's 0–5 self-score — fewer, more meaningful choices at the prompt.
- **A thin scheduler boundary in `learning/src/scheduler.ts`**: the rest of the code
  sees `rate(state, grade, now) → state` and `projections(state, now)` (the next
  interval per grade — shown at the prompt, Anki-style). `ts-fsrs` types never leak
  past this module, so the scheduler stays swappable and testable. `now` is always a
  parameter — no `Date.now()` inside the module.
- **Storage in the existing SQLite**: `recall_state` (slug PK, `dueAt` column for the
  due-query, FSRS card state as a JSON column — stability, difficulty, reps, lapses,
  state, last review) plus `review_log` (date, reviewed count) for the streak. Tables
  created idempotently like the store's others. New concepts enter in FSRS's `New`
  state — due immediately.
- **The session shape:** `daimon review` pulls due concepts (cap 10, oldest-due first).
  Per concept: show name + kind → user recalls → any key reveals the grounded example →
  grade `1`–`4`, each key labeled with its projected next interval ("3: good — 6d") →
  next. End: one summary line ("7 reviewed · next due tomorrow · streak 4 days").
  Nothing due → print when the next review is, exit 0.
- **Streak = consecutive calendar days with a non-empty `review_log` entry.**
  `daimon review --streak` prints it — that's the phase-2 exit criterion, made checkable.

## Steps

**1. ADR + scheduler boundary.** ADR-0008; `scheduler.ts` wrapping `ts-fsrs`. Tests:
reference-vector table — a fixed grade sequence from a fixed date must reproduce known
`ts-fsrs` outputs exactly (pins the dependency's behavior; a version bump that shifts
schedules fails loudly); `Again` increments lapses and re-enters relearning; projections
return four distinct intervals; grade clamping.

**2. Storage.** `recall_state` + `review_log` in the store; due-query (cap, oldest-due
first); streak query. Tests: due ordering, new-concept-due-now, corrupt card JSON →
state reset to `New` with a warning (never a throw), streak over gap days (broken
streak → 1, not 0, on the day you resume).

**3. The review flow.** Readline loop, grade validation (re-ask on junk input), ctrl+c
mid-review saves grades already given. Tests: scripted stdin fixtures through the flow;
interrupt path.

**4. Wire + prove.** `daimon review` / `daimon review --streak` subcommands in `cli`. Live
proof: run a real review over this repo's ledger concepts (the concept-ledger brief has
by now produced them), confirm due dates move per grade, run again → "nothing due".
Tick the §7 checkbox — and start the streak, because the phase-2 exit clock runs on it.

## Done when (verification criteria)

- `bun run verify` green.
- The reference-vector suite reproduces known `ts-fsrs` schedules exactly (documented
  in the test as the source of truth).
- A real `daimon review` session: grades persist, `Good` and `Again` visibly diverge the
  next due dates, immediate re-run finds nothing due, `--streak` reports correctly the
  next day.
- Interrupting mid-review loses nothing already graded.
- The whole flow runs with `ANTHROPIC_API_KEY` unset — zero network.

## Out of scope (v1)

Per-user FSRS parameter optimization (needs review history — the review log is its
future training data) · model-graded answers / teach-back (bridge brief) · review
inside the TUI/REPL (`/review` is taken by mentor mode; recall stays a subcommand) ·
notifications/reminders · per-concept suspend/bury · migrating any SM-2 state (none
ever shipped).
