# Brief: Mentor mode (phase-2 gate item, build order 2)

The deep learning mode from PLAN §10.3: daimon scaffolds the change but leaves deliberate
`TODO(you)` gaps at *decision points*, ends its turn, waits for the user to fill them,
then reviews the user's diff like a senior engineer — approving, correcting, explaining.
This is the feature the Claude Code "Learning" output style approximates and the one
daimon has to beat; the difference is the review-of-your-edit half, which nobody ships.

## Constraints (non-negotiable)

- **Modes are prompt overlays plus small loop behaviors** (DEVELOPMENT.md §4). The only
  loop behavior allowed here is a turn-end hook that snapshots gap files. If it grows
  beyond that, stop and write the ADR first.
- **Gaps are decision points, never boilerplate** (PLAN §16). This is a prompt-quality
  bar, verified by eye on real runs, and it is the difference between mentoring and
  homework. 5–15 gaps per task; each gap states the question being decided.
- **The review is anchored to the diff.** The review turn feeds the model the *actual
  unified diff* of the user's edits — never "review what the user probably did". Model
  claims about the user's code follow the same epistemic rule as everything else:
  anchored to artifacts.
- All scaffolding edits go through the normal gate + snapshot path — mentor changes
  nothing about permissions.
- Tests colocated, failure paths mandatory. `bun run verify` green at every step.

## Design decisions (already made — don't relitigate)

- **`mentor` joins `SessionMode`** (`default | explain | mentor`), a `MODE_OVERLAYS`
  entry, `/mode mentor` validation updated. The overlay carries the full contract:
  scaffold the structure, leave `// TODO(you): <the decision, as a question>` gaps
  (comment syntax per language), end the turn telling the user to fill them and run
  `/review`.
- **Gap marker is exactly `TODO(you):`** — greppable, testable, renderer-highlightable
  later.
- **Baselines via the existing snapshot store.** At mentor turn end, the loop records a
  *mentor baseline* (path + content) for every file daimon touched that contains a
  `TODO(you)` marker. Reuses the snapshot machinery with its own label so `/undo`
  semantics are untouched.
- **`/review` is a command, not loop surgery.** It reads each baselined file, computes
  the unified diff baseline → current (the `diff` dependency is already in the tree from
  edit_file), assembles a user message — "here is my edit against your scaffold — review
  it" + the diffs — and runs a normal turn. The overlay's review register tells the model
  how: verdict per gap (approve / correct with a fix / explain the trade-off), senior
  and specific, no grades for style.
- **`/review` with no baseline** says so ("no mentor scaffold pending") — never errors.
- **Unfilled gaps are fine.** The review names them and asks, it doesn't scold.

## Steps

**1. Mode + overlay.** `SessionMode` extension, overlay text, `/mode` validation, mode
persisted on resume (the field already round-trips). Tests: overlay selected, `/mode
mentor` accepted, unknown mode still rejected.

**2. Baseline capture.** Turn-end hook: in mentor mode, detect touched files containing
`TODO(you)`, store baselines. Tests: baseline recorded only in mentor mode, only for
gap files; second scaffold turn replaces baselines; interrupt mid-turn still captures
what was written.

**3. `/review`.** Diff assembly + message construction + baseline clear on completion.
Tests: diff matches a scripted edit, no-baseline path, deleted-file path (baseline
exists, file gone → reported, not thrown).

**4. Prove + close.** Integration test: scripted mentor turn (mock model emits scaffold
with gaps) → user edit applied to disk → `/review` turn receives the right diff. Live
proof on a real model against this repo: one small real task (e.g. add a config field)
in mentor mode — count the gaps, judge their quality, run `/review`, judge the review.
Report both honestly in the commit body. Tick the §7 checkbox.

## Done when (verification criteria)

- `bun run verify` green; smoke green.
- Integration proves: baselines only in mentor mode; `/review`'s message contains the
  byte-accurate diff of the user's edit; baselines cleared after review.
- Live run on this repo: scaffold has 5–15 `TODO(you)` gaps and **every gap is a
  decision, not boilerplate** (Giannis-judged — this is the experience test that
  outranks the suite); the review addresses each gap against the actual diff.
- `/review` before any mentor turn, and in `default` mode, degrades to a notice.

## Out of scope (v1)

Gap navigation in the TUI (jump-to-next-TODO) · per-gap threaded discussion · teach-back
gating of the review (that's the Semideus bridge brief) · mentor in headless `-p` mode
(interactive by nature; `-p` + mentor prints a notice and runs `default`).
