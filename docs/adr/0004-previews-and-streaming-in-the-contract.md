# ADR-0004 — Approval previews and streaming deltas extend the shared contracts

**Status:** accepted · 2026-07-17

## Context

Two phase-1 gaps lived in the honesty ledger. Approval prompts showed the model's stated intent, not the change — the diff was computed inside `run()`, after the yes (felt as friction in dogfood task 3). And the loop bought its testability with `generateText`, so renderers had nothing to stream. Both fixes touch contracts shared across packages.

## Decision

- `Tool` gains optional `preview(input, ctx) → ToolArtifacts | null`: the would-be effect, computed read-only — no writes, no snapshots, never throws, `null` when nothing useful is computable. `edit_file`/`write_file` share one plan step between `preview()` and `run()`, so the diff the user approves and the diff that gets applied come from the same code; `run()` recomputes from current disk state, keeping the executed change honest if the file moved after approval. `bash` previews the full command (its summary truncates).
- `PermissionGate.check` accepts the preview as a lazy thunk and awaits it only on the ask path, inside try/catch: a crashing preview neither blocks the ask nor slips past it, and allow/deny rules never pay for it. The prompter receives it as `ApprovalRequest.preview`.
- The loop streams (`streamText`): each text chunk is emitted as an `assistant-delta` event; the `assistant-text` event that follows remains the authoritative full text, so renderers may drop deltas entirely (headless print does).

## Consequences

- Any renderer shows the change before the yes by reading `request.preview` — the phase-1 TUI overlay renders the diff there; no renderer-specific plumbing in core.
- Previews run pre-approval by definition: tool authors must keep them read-only. The tool checklist gains that rule.
- Loop tests script V3 `doStream` parts instead of `doGenerate` responses; the mid-stream error path is pinned to the old semantics — a failed step tracks no usage and appends no messages.
