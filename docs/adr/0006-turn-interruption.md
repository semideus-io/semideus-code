# ADR-0006 — Turn interruption via AbortSignal, kept history stays provider-valid

**Status:** accepted · 2026-07-18

## Context

The last phase-1 ledger row: input was ignored while a turn ran — no way to stop a wrong-direction model or a runaway local loop short of killing the process. Under the local-model dogfood protocol this is the biggest daily-driver gap, and interruption touches the loop, the tool contract, and both frontends at once.

## Decision

- `runTurn` accepts an optional `AbortSignal`; the cli owns the `AbortController` (one per turn). TUI: esc while running. Headless: first ctrl+c interrupts, second force-quits.
- The stream is cut via `streamText`'s own abort handling; text streamed before the cut is kept — pushed to history as a normal assistant message and emitted as non-final `assistant-text`. A tool call the model never finished emitting is never executed.
- Interrupting a tool batch answers every unrun call with an `execution-denied` "turn interrupted" result, because a native history with a tool-use and no tool-result is rejected by providers on resume. Executed calls keep their real results; only they reach the decision log.
- `ToolContext` gains `signal?: AbortSignal`. `bash` kills its process on abort and reports `(interrupted)`; fast tools may ignore it.
- An interrupted turn ends like any other: interrupt notice, `persist()`, `turn-end`. No new event types — renderers already draw notices.
- Approval prompts are not an abort path: esc at the overlay is the existing deny. The headless readline question aborts to deny — never an implicit yes.

## Consequences

- Interruption is a loop feature, not a TUI feature: any frontend gets it by passing a signal, and headless CI mode (phase 3) inherits it.
- The aborted step tracks no usage — the provider reports none for a cut stream. /cost undercounts interrupted turns; acceptable, noted here.
- Tool authors adding long-running tools must honor `ctx.signal` or accept kill-at-batch-boundary semantics.
