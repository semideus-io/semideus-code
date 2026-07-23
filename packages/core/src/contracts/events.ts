import type { PermissionClass, ToolArtifacts } from "./tool";

export type DecisionKind = "plan" | "tool_call" | "edit" | "conclusion";

/**
 * The glass-box spine of the product: one entry per meaningful agent action.
 * The learning layer reads exclusively from these plus the artifacts they reference.
 *
 * `rationale` is the model's *stated* account — never ground truth. It is only
 * ever presented anchored to `refs`: the observable artifacts (files touched,
 * commands run) that make it checkable.
 */
/**
 * The evidence for a decision. `refs` *name* the artifact; this **is** the
 * artifact — the diff that was applied, the output a command actually printed.
 * `/why` renders it beside the rationale so the model's stated account is
 * checkable against what happened, which is the whole epistemic contract.
 * Truncated at write time: the log stays queryable, not a blob store.
 */
export interface DecisionArtifact {
  /** Unified diff, for edits. */
  diff?: string;
  /** What the command printed, head+tail if long. */
  output?: string;
}

export interface DecisionEvent {
  ts: number;
  sessionId: string;
  step: number;
  kind: DecisionKind;
  /** What happened, one line. */
  summary: string;
  /** The model's stated why (1–2 sentences). May be empty. */
  rationale: string;
  /** Options the model says it considered. */
  alternatives?: string[];
  /** Files touched, commands run, diff ids. */
  refs: string[];
  /** The observable evidence behind this step. Absent for read-class steps. */
  artifact?: DecisionArtifact;
}

export interface UsageTotals {
  /** Total prompt tokens, including the cached portions below. */
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from the provider's cache (billed at ~0.1× the input rate). */
  cacheReadTokens: number;
  /** Prompt tokens written to the provider's cache (billed at ~1.25× the input rate). */
  cacheWriteTokens: number;
  costUsd: number;
}

/**
 * Everything the outside world (REPL today, Ink TUI in phase 1, CI mode later)
 * learns about a running turn. Renderers own no agent state — they draw these.
 */
export type AgentEvent =
  | { type: "turn-start"; sessionId: string }
  | {
      /**
       * A streamed chunk of the assistant message in flight. Renderers with a
       * live region draw these; the assistant-text event that follows is the
       * authoritative full text (deltas may be dropped, never trusted alone).
       */
      type: "assistant-delta";
      text: string;
    }
  | {
      type: "assistant-text";
      text: string;
      /** True for the concluding answer; false for narration between tool calls. */
      final: boolean;
    }
  | {
      type: "tool-start";
      step: number;
      tool: string;
      summary: string;
      permission: PermissionClass;
    }
  | {
      type: "tool-end";
      step: number;
      tool: string;
      ok: boolean;
      output: string;
      permission: PermissionClass;
      artifacts?: ToolArtifacts;
    }
  | { type: "tool-denied"; step: number; tool: string; reason: string }
  | { type: "notice"; text: string }
  | { type: "error"; message: string }
  | { type: "turn-end"; turn: UsageTotals; session: UsageTotals };

export type EventSink = (event: AgentEvent) => void;
