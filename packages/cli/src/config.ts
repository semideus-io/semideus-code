import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError, configSchema, type DemiConfig } from "@semideus/providers";
import { parse as parseToml } from "smol-toml";

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "demi");
}

export const DEFAULT_CONFIG_TOML = `# demi — Semideus Code configuration
# Model entries here are merged over the built-ins ("default", "cheap").
# cost_in / cost_out are USD per million tokens and only drive /cost estimates —
# keep them current with your provider's pricing.
# prompt_cache (default true, Anthropic only) marks cache breakpoints on the
# system prompt and recent history, so agent steps re-read the conversation at
# ~0.1× the input price instead of re-buying it. Set false to disable per model.

[models.default]
provider = "anthropic"
model    = "claude-sonnet-5"
cost_in  = 3.0
cost_out = 15.0

[models.cheap]
provider = "anthropic"
model    = "claude-haiku-4-5-20251001"
cost_in  = 1.0
cost_out = 5.0

# Local endpoint (Ollama / LM Studio / vLLM) — uncomment and adjust:
# [models.local]
# provider  = "openai-compatible"
# base_url  = "http://localhost:11434/v1"
# model     = "qwen3-coder:30b"
# tool_mode = "native"         # or json-fallback / xml-repair for models without native tools
# include_usage = true         # default; stream token usage so /cost and context warnings work.
#                              # Set false for compat servers that reject stream_options.

[permissions]
read    = "allow"
write   = "ask"
execute = "ask"
network = "ask"

[limits]
max_steps = 32
`;

export interface LoadedConfig {
  config: DemiConfig;
  path: string;
  created: boolean;
}

export function loadConfig(): LoadedConfig {
  const path = join(configDir(), "config.toml");
  let created = false;
  if (!existsSync(path)) {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(path, DEFAULT_CONFIG_TOML);
    created = true;
  }

  let raw: unknown;
  try {
    raw = parseToml(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(
      `could not parse ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`invalid config at ${path}:\n${issues}`);
  }

  return { config: parsed.data, path, created };
}
