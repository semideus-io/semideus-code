import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelSpec } from "@semideus/core";
import { wrapLanguageModel } from "ai";
import { anthropicPromptCache } from "./cache";
import { ConfigError, type ModelConfig } from "./config";

export function buildModelSpec(
  id: string,
  models: Record<string, ModelConfig>,
  env: Record<string, string | undefined> = process.env,
  /** Test seam: wire-format tests capture the request without a live endpoint. */
  fetchImpl?: typeof fetch,
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
        `model "${id}" (${cfg.model}) needs ${envName} — export it or set api_key_env in ~/.config/daimon/config.toml`,
      );
    }
    const anthropic = createAnthropic({ apiKey, fetch: fetchImpl });
    const base = anthropic(cfg.model);
    const model = cfg.prompt_cache
      ? wrapLanguageModel({ model: base, middleware: anthropicPromptCache() })
      : base;
    return toSpec(id, cfg, model);
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
    includeUsage: cfg.include_usage,
    fetch: fetchImpl,
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
