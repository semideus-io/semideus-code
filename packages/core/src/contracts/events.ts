import type { ToolArtifacts } from "./tool";

export type DecisionKind = "plan" | "tool_call" | "edit" | "conclusion";

/**
 * The glass-box spine of the product: one entry per meaningful agent action.
 * The learning layer reads exclusively from these plus the artifacts they reference.
 *
 * `rationale` is the model's *stated* account — never ground truth. It is only
 * ever presented anchored to `refs`: the observable artifacts (files touched,
 * commands run) that make it checkable.
 */
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
  | { type: "assistant-text"; text: string }
  | { type: "tool-start"; step: number; tool: string; summary: string }
  | {
      type: "tool-end";
      step: number;
      tool: string;
      ok: boolean;
      output: string;
      artifacts?: ToolArtifacts;
    }
  | { type: "tool-denied"; step: number; tool: string; reason: string }
  | { type: "notice"; text: string }
  | { type: "error"; message: string }
  | { type: "turn-end"; usage: UsageTotals };

export type EventSink = (event: AgentEvent) => void;
