import type { ModelConfig } from "@semideus/providers";

export interface ModelChoice {
  /** Config id to build the spec from. */
  id: string;
  /** Shown to the user when the stored choice could not be honored. */
  notice?: string;
}

/**
 * Which model a session runs on, in priority order:
 *
 * 1. an explicit `-m` — the user said so;
 * 2. the model a resumed session already ran on — continuing a local session on
 *    the paid cloud default would spend money nobody asked to spend;
 * 3. `default`.
 *
 * A stored id outlives its config entry when a model is renamed or removed, so
 * an unknown one falls back *loudly* rather than making the session unresumable.
 */
export function resolveModelId(
  flagModel: string | undefined,
  resumedModel: string | undefined,
  models: Record<string, ModelConfig>,
): ModelChoice {
  if (flagModel) return { id: flagModel };
  if (!resumedModel) return { id: "default" };
  if (models[resumedModel]) return { id: resumedModel };
  return {
    id: "default",
    notice: `session ran on "${resumedModel}", which is no longer configured — using default`,
  };
}
