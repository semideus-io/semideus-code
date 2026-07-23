import { describe, expect, test } from "bun:test";
import { streamText } from "ai";
import { modelConfigSchema } from "./config";
import { buildModelSpec } from "./factory";

/**
 * Wire-format tests for the openai-compatible path: local endpoints (Ollama,
 * LM Studio) only report token usage on streams when the request asks via
 * stream_options.include_usage — without it /cost reads 0 and the context
 * warning never fires (dogfood 2026-07-17). Pins request AND response mapping
 * so a provider bump can't silently blind local runs again.
 */

function sseBody(withUsage: boolean): string {
  const chunks = [
    `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}`,
    `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
    ...(withUsage
      ? [
          `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}`,
        ]
      : []),
    "[DONE]",
  ];
  return `${chunks.map((c) => `data: ${c}`).join("\n\n")}\n\n`;
}

/** A compat model whose "endpoint" echoes usage only when the request asks for it. */
function compatModel(overrides: Record<string, unknown>, bodies: unknown[]) {
  const captureFetch: typeof fetch = Object.assign(
    async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { stream_options?: unknown };
      bodies.push(body);
      return new Response(sseBody(body.stream_options !== undefined), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
    { preconnect: fetch.preconnect },
  );
  const cfg = modelConfigSchema.parse({
    provider: "openai-compatible",
    model: "test-model",
    base_url: "http://localhost:9/v1",
    ...overrides,
  });
  return buildModelSpec("local", { local: cfg }, {}, captureFetch);
}

describe("openai-compatible usage reporting", () => {
  test("include_usage defaults on and can be switched off in config", () => {
    const on = modelConfigSchema.parse({ provider: "openai-compatible", model: "m" });
    expect(on.include_usage).toBe(true);
    const off = modelConfigSchema.parse({
      provider: "openai-compatible",
      model: "m",
      include_usage: false,
    });
    expect(off.include_usage).toBe(false);
  });

  test("streams request usage and the reported tokens reach totalUsage", async () => {
    const bodies: Array<{ stream_options?: unknown }> = [];
    const spec = compatModel({}, bodies);

    const result = streamText({ model: spec.model, prompt: "hi" });
    let text = "";
    for await (const chunk of result.textStream) text += chunk;

    expect(bodies[0]?.stream_options).toEqual({ include_usage: true });
    expect(text).toBe("hi");
    const usage = await result.totalUsage;
    // the exact numbers the fake endpoint reported — this is what /cost and
    // the 70% context warning read via Session.trackUsage
    expect(usage.inputTokens).toBe(7);
    expect(usage.outputTokens).toBe(3);
  });

  test("include_usage = false sends no stream_options for strict endpoints", async () => {
    const bodies: Array<{ stream_options?: unknown }> = [];
    const spec = compatModel({ include_usage: false }, bodies);

    const result = streamText({ model: spec.model, prompt: "hi" });
    for await (const _ of result.textStream) {
      // drain
    }

    expect(bodies[0]?.stream_options).toBeUndefined();
    const usage = await result.totalUsage;
    expect(usage.inputTokens ?? 0).toBe(0);
  });
});
