import { describe, expect, test } from "bun:test";
import type { ModelConfig } from "@semideus/providers";
import { resolveModelId } from "./model-choice";

const models: Record<string, ModelConfig> = {
  default: { provider: "anthropic", model: "claude-sonnet-5" } as ModelConfig,
  local: { provider: "openai-compatible", model: "qwen3-coder:30b" } as ModelConfig,
};

describe("resolveModelId", () => {
  test("a fresh session with no flag gets the default", () => {
    expect(resolveModelId(undefined, undefined, models)).toEqual({ id: "default" });
  });

  test("an explicit -m wins over the resumed session's model", () => {
    expect(resolveModelId("default", "local", models)).toEqual({ id: "default" });
  });

  test("resuming without a flag keeps the model the session ran on", () => {
    // The money bug: this used to resolve to "default", silently moving a free
    // local session onto the paid cloud model.
    expect(resolveModelId(undefined, "local", models)).toEqual({ id: "local" });
  });

  test("a stored model that no longer exists falls back loudly, not fatally", () => {
    const choice = resolveModelId(undefined, "local-old", models);
    expect(choice.id).toBe("default");
    expect(choice.notice).toContain("local-old");
    expect(choice.notice).toContain("no longer configured");
  });
});
