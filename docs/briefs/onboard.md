# Brief: `/onboard` + FOR-YOU.md (phase-2 gate item, build order 6 — closes the phase)

`/onboard` walks a codebase daimon has never seen and leaves the user oriented: a guided
tour off the repo map, an architecture narrative, the five files that matter, and a
generated `FOR-YOU.md` capturing it — written through the gate like any other edit.
PLAN §10.6. It's last in the phase because it composes what the phase built: the repo
map feeds it, `explain`-register prose carries it, and the concept ledger can seed a
"concepts you'll meet here" section.

## Constraints (non-negotiable)

- **`/onboard` is a prompt recipe, not a new loop.** It assembles a scripted user turn
  and runs the normal loop: read-class exploration (repo map, key files) needs no
  approvals; the single mutation — writing `FOR-YOU.md` — goes through the gate with
  the full file previewed. No special-cased tool behavior.
- **Every claim in FOR-YOU.md must be checkable against the repo.** The recipe instructs:
  name files and line-anchored facts, never describe code you didn't read this session.
  The standing epistemic rule, applied to onboarding.
- **Graceful on hostile input**: no repo map (grammar missing, non-TS repo), no
  AGENTS.md, empty repo → the tour degrades to what's actually available and says so.
- Tests colocated. `bun run verify` green at every step.

## Design decisions (already made — don't relitigate)

- **FOR-YOU.md structure is fixed** (the recipe demands these sections, in order):
  *What this is* (2–3 sentences) · *How it's shaped* (architecture narrative, package/
  module map) · *The five files that matter* (path + one line each on why) · *How to
  run and test it* (from actual scripts/configs read, not guessed) · *Where to start
  reading* (an ordered path through the code). "Five files" is a discipline, not a
  count-up — the recipe says pick exactly five.
- **The tour renders in the transcript first, then offers the write.** The user gets
  the narrative conversationally; `FOR-YOU.md` is the take-away artifact at the end,
  approved as a diff like everything else.
- **If the concept ledger has entries for this project**, the recipe appends a
  *Concepts you'll meet* section from them. Empty ledger → section omitted. No model
  invention of concepts at onboard time.
- **`/onboard` re-run overwrites** (it's generated, dated in a header line, and cheap
  to regenerate) — after the usual gate approval on the diff.

## Steps

**1. Recipe + command.** The prompt template (structure above, epistemic instructions,
degradation clauses) + `/onboard` in `cli/src/commands.ts` seeding the turn. Tests:
recipe assembly with/without repo map, with/without ledger entries.

**2. Prove on the dogfood target.** Run `/onboard` on this repo. Judge FOR-YOU.md:
are the five files the right five (loop, permissions, session/store, edit_file,
prompt)? Is every claim true? Fix the recipe, not the output.

**3. Prove on a foreign repo.** The real test: a repo daimon has never seen (pick any
mid-size TS project). `/onboard`, then spot-check every factual claim in FOR-YOU.md
against the code. Report the hit rate honestly in the commit body. Tick the final §7
feature checkbox — phase 2's feature list is done; the exit criterion (review streak)
keeps running on its own clock.

## Done when (verification criteria)

- `bun run verify` green.
- On this repo: FOR-YOU.md names the actual load-bearing files and the run/test
  commands match `package.json` reality.
- On a foreign repo: every spot-checked claim traces to real code; anything daimon didn't
  read isn't asserted.
- The write was gated and previewed; `/undo` restores the pre-onboard state.
- With `.daimon/cache` deleted and no AGENTS.md present, `/onboard` still completes with
  an honest, smaller tour.

## Out of scope (v1)

Multi-file onboarding docs · language-aware tours beyond what the TS-only repo map
gives · auto-refresh of FOR-YOU.md on repo changes · onboarding quizzes (recall owns
review; a FOR-YOU-derived deck is a later idea for the ledger).
