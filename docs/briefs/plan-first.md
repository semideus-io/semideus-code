# Brief: Plan-first mode (phase-2 gate item, build order 1)

Before daimon mutates anything, it proposes a numbered plan — one line of *what* and one of
*why* per step — and the user approves, edits, or rejects it before any write/execute
tool runs. PLAN §10.2 calls this "one system-prompt state + one approval UI", and that's
exactly the build: the approval UI already exists (ADR-0004), and the plan rides through
it. "Edit" is real: the plan opens in `$EDITOR`, git-commit style, and the user's edited
text is what gets approved and executed. This completes the first phase-2 checkbox (the
`/why` panel half landed in `dfe6a15`).

## Constraints (non-negotiable)

- **The plan goes through the permission gate.** No parallel approval path. The plan is a
  tool call whose `preview()` renders the numbered plan; approving it is the same
  mechanic as approving a diff. ADR-0004's rule holds: what you approved is what happens.
- **Plan-first enforcement lives in the gate as policy**, not as a loop special case.
  When plan-first is on and no plan has been approved this turn, `write`/`execute` calls
  are denied with a message that tells the model what to do ("propose a plan with
  propose_plan first"). `--yes` auto-approves plans like everything else — headless
  one-shots must not hang.
- **This touches the product contract** (new tool + gate behavior) → **ADR-0007** before
  the wiring commit (context → decision → consequences, ~15 lines).
- Tests colocated, failure paths mandatory. `bun run verify` green at every step.

## Design decisions (already made — don't relitigate)

- **The plan is a tool: `propose_plan`** in `packages/tools`, schema
  `{ steps: [{ what, why }] }`, every field `.describe()`d. `summarize()` → "plan: N
  steps". `preview()` renders the numbered list with per-step rationale. `run()` mutates
  nothing; it returns `ok: true, output: "plan approved — execute it step by step"`.
- **New `PermissionClass: "plan"`** in `core/src/contracts/tool.ts`. Default policy:
  always ask. "Always this session" is allowed — auto-accepting plans is the user's
  right, and it flows through the gate like every policy.
- **Plan-first is a session flag, not an output mode.** `session.config.planFirst:
  boolean`, toggled with `/plan on|off` — orthogonal to `/mode explain|mentor`, so the
  two compose. When on, a prompt overlay section instructs: plan before mutating,
  re-plan if the plan is rejected or reality diverges from it.
- **Approved plans land in the decision log** as `DecisionEvent` kind `"plan"` (the kind
  already exists), summary = the numbered steps *as approved* — edited text, not the
  model's original — so `/why` shows the plan the user actually signed off on.
- **"Edit" = `$EDITOR`, git-commit style.** The approval prompt gains an `e` key (both
  the TUI overlay and the headless prompt): the plan is written to a temp file as plain
  numbered text, `$EDITOR` (fallback `vi`) opens it, and on save-and-quit the edited
  text becomes the approved plan — parsed leniently back into steps, carried in the
  `ToolResult.output` so the model executes *your* version. ADR-0004's rule gets its
  strongest form here: what runs is what you wrote. Empty file or unchanged buffer on
  quit → treated as plain approval; editor exits non-zero → back to the prompt,
  nothing approved.
- **The TUI suspends around the editor** (Ink pauses rendering, terminal handed to the
  editor, screen restored after). Headless needs no suspension — it's already a plain
  terminal. `--yes`/non-interactive runs never spawn an editor.
- **Reject still carries a note** — deny with a reason and the model re-plans. Edit and
  reject are complements: edit when the plan is close, reject when the approach is
  wrong.

## Steps

**1. Contract + tool.** `"plan"` permission class; `propose_plan` with schema,
`summarize`, `preview`, `run`. Tests: schema lenience (missing `why` tolerated), preview
renders every step, run never throws.

**2. Gate policy.** Default-ask for `plan`; the plan-first denial rule (write/execute
before an approved plan → instructive denial; read-class always fine). Tests: denial
message, read tools unaffected, approval unlocks the turn, next turn re-locks,
`--yes` passes plans.

**3. Prompt + command.** Overlay section under `planFirst`; `/plan on|off` in
`cli/src/commands.ts` (one implementation, both renderers). Persist the flag with the
session like `mode` is.

**4. The `e` key.** Editor round-trip: temp file write → spawn `$EDITOR` (Ink suspended
in the TUI; plain spawn headless) → lenient re-parse → edited plan into the
`ToolResult` and decision log. Tests use the trick that makes this automatable:
`EDITOR` pointed at a script (`sed -i`-style) that rewrites the file non-interactively —
covers the edited, unchanged, emptied, and non-zero-exit paths without a human at a
keyboard.

**5. Wire + prove.** Loop integration test with `MockLanguageModelV3`: scripted
edit-before-plan → denied → propose_plan → approved → edit runs; a rejected plan →
revised plan turn; an edited plan → model receives the *edited* steps. Write ADR-0007
(covering the plan class, gate enforcement, and the editor mechanic). Live: PTY run —
plan overlay renders before approval, `e` with `EDITOR=nano`-class editor round-trips,
deny-with-note produces a revised plan; `bun run smoke` still green. Tick the
DEVELOPMENT.md §7 checkbox (its `/why`+plan-first bullet is now fully true).

## Done when (verification criteria)

- `bun run verify` green; smoke green.
- Integration test proves the invariant: **with plan-first on, no mutating tool ever runs
  before a plan is approved in that turn** — including after an interrupt/resume.
- The edit path proves the stronger invariant: **what the model executes is the user's
  edited text** — asserted byte-level in the scripted-`EDITOR` test, and `/why` lists
  the approved plan as a `plan` decision with the *edited* steps.
- PTY run shows the numbered plan rendered *before* the approve keypress (ADR-0004
  standard), and the TUI screen survives an editor suspend/restore intact.
- Headless `daimon -p --yes` with plan-first on completes without hanging and never
  spawns an editor.

## Out of scope (v1)

Inline (in-TUI) plan editing — still blocked on cursor-key input, and `$EDITOR` covers
the need · plan progress tracking / step checkoff during execution · auto re-plan
detection when the diff diverges from the plan (the prompt asks the model to re-plan;
enforcement is later).
