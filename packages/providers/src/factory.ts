import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelSpec } from "@semideus/core";
import { ConfigError, type ModelConfig } from "./config";

export function buildModelSpec(
  id: string,
  models: Record<string, ModelConfig>,
  env: Record<string, string | undefined> = process.env,
): ModelSpec {
  const cfg = models[id];
  if (!cfg) {
    throw new ConfigError(
      `no model named "${id}" — known models: ${Object.keys(models).join(", ")}`,
    );
  }

  if (cfg.provider === "anthropic") {
    const envName = cfg.api_key_env ?? "ANTHROPIC_API_KEY";
    const apiKey = env[envName];
    if (!apiKey) {
      throw new ConfigError(
        `model "${id}" (${cfg.model}) needs ${envName} — export it or set api_key_env in ~/.config/demi/config.toml`,
      );
    }
    const anthropic = createAnthropic({ apiKey });
    return toSpec(id, cfg, anthropic(cfg.model));
  }

  // openai-compatible: Ollama, LM Studio, vLLM, OpenRouter, …
  if (!cfg.base_url) {
    throw new ConfigError(`model "${id}" is openai-compatible and needs base_url in config`);
  }
  const apiKey = cfg.api_key_env ? env[cfg.api_key_env] : undefined;
  const provider = createOpenAICompatible({
    name: id,
    baseURL: cfg.base_url,
    apiKey: apiKey ?? "not-needed",
  });
  return toSpec(id, cfg, provider(cfg.model));
}

function toSpec(id: string, cfg: ModelConfig, model: ModelSpec["model"]): ModelSpec {
  return {
    id,
    model,
    modelName: cfg.model,
    contextWindow: cfg.context_window,
    toolMode: cfg.tool_mode,
    costPerMTok: { in: cfg.cost_in, out: cfg.cost_out },
  };
}
