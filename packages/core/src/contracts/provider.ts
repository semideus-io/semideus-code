import type { LanguageModel } from "ai";

/**
 * Tool-call capability tiers. `native` passes tools through the provider API.
 * `json-fallback` and `xml-repair` (phase 1) make weak local models usable by
 * prompting for structured output and validating/repairing with Zod.
 */
export type ToolMode = "native" | "json-fallback" | "xml-repair";

export interface ModelSpec {
  /** Config id: "default", "cheap", "local", … */
  id: string;
  model: LanguageModel;
  /** Provider-facing model name, e.g. "claude-sonnet-5". */
  modelName: string;
  contextWindow: number;
  toolMode: ToolMode;
  /** USD per million tokens — drives /cost estimates. */
  costPerMTok: { in: number; out: number };
}
