import { z } from "zod";

export class ConfigError extends Error {}

export const modelConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai-compatible"]),
  model: z.string(),
  base_url: z.string().optional(),
  api_key_env: z.string().optional(),
  context_window: z.number().int().positive().default(200_000),
  tool_mode: z.enum(["native", "json-fallback", "xml-repair"]).default("native"),
  cost_in: z.number().nonnegative().default(0),
  cost_out: z.number().nonnegative().default(0),
  prompt_cache: z.boolean().default(true),
  // openai-compatible only: ask the endpoint to report token usage on streams
  // (stream_options.include_usage) — /cost and context warnings are blind
  // without it. Off-switch for compat servers that reject the field.
  include_usage: z.boolean().default(true),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

const policyRule = z.enum(["allow", "ask", "deny"]);

export const configSchema = z.object({
  models: z.record(z.string(), modelConfigSchema).default({}),
  permissions: z
    .object({
      read: policyRule.default("allow"),
      write: policyRule.default("ask"),
      execute: policyRule.default("ask"),
      network: policyRule.default("ask"),
    })
    .default({ read: "allow", write: "ask", execute: "ask", network: "ask" }),
  limits: z
    .object({
      max_steps: z.number().int().min(1).max(200).default(32),
    })
    .default({ max_steps: 32 }),
});

export type DaimonConfig = z.infer<typeof configSchema>;

/**
 * Built-in model entries; user config with the same id overrides them.
 * cost_* are USD per million tokens and only drive /cost estimates — keep
 * them current with provider pricing.
 */
export const BUILTIN_MODELS: Record<string, ModelConfig> = {
  default: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    context_window: 200_000,
    tool_mode: "native",
    cost_in: 3,
    cost_out: 15,
    prompt_cache: true,
    include_usage: true,
  },
  cheap: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    context_window: 200_000,
    tool_mode: "native",
    cost_in: 1,
    cost_out: 5,
    prompt_cache: true,
    include_usage: true,
  },
};

export function mergedModels(config: DaimonConfig): Record<string, ModelConfig> {
  return { ...BUILTIN_MODELS, ...config.models };
}
