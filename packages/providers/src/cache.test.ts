import { describe, expect, test } from "bun:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { anthropicPromptCache } from "./cache";

type Transform = NonNullable<LanguageModelMiddleware["transformParams"]>;
type CallOptions = Awaited<ReturnType<Transform>>;
type Prompt = CallOptions["prompt"];

async function transform(prompt: Prompt): Promise<CallOptions> {
  const middleware = anthropicPromptCache();
  if (!middleware.transformParams) throw new Error("middleware has no transformParams");
  return middleware.transformParams({
    type: "generate",
    params: { prompt } as CallOptions,
    model: {} as Parameters<Transform>[0]["model"],
  });
}

function user(text: string): Prompt[number] {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistant(text: string): Prompt[number] {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function cacheControlOf(message: Prompt[number] | undefined): unknown {
  const anthropic = message?.providerOptions?.anthropic as { cacheControl?: unknown } | undefined;
  return anthropic?.cacheControl;
}

describe("anthropicPromptCache", () => {
  test("marks the system message and the last two messages, nothing else", async () => {
    const prompt: Prompt = [
      { role: "system", content: "be helpful" },
      user("first ask"),
      assistant("first answer"),
      user("second ask"),
    ];

    const out = await transform(prompt);

    expect(cacheControlOf(out.prompt[0])).toEqual({ type: "ephemeral" });
    expect(cacheControlOf(out.prompt[1])).toBeUndefined();
    expect(cacheControlOf(out.prompt[2])).toEqual({ type: "ephemeral" });
    expect(cacheControlOf(out.prompt[3])).toEqual({ type: "ephemeral" });
  });

  test("stays within Anthropic's four-breakpoint limit on long prompts", async () => {
    const prompt: Prompt = [
      { role: "system", content: "be helpful" },
      ...Array.from({ length: 10 }, (_, i) => user(`message ${i}`)),
    ];

    const out = await transform(prompt);

    const marked = out.prompt.filter((m) => cacheControlOf(m) !== undefined);
    expect(marked.length).toBe(3);
  });

  test("preserves existing providerOptions on marked messages", async () => {
    const last: Prompt[number] = {
      ...user("ask"),
      providerOptions: { anthropic: { sendReasoning: true }, other: { keep: 1 } },
    };
    const out = await transform([{ role: "system", content: "sys" }, last]);

    const options = out.prompt[1]?.providerOptions;
    expect(options?.anthropic).toEqual({
      sendReasoning: true,
      cacheControl: { type: "ephemeral" },
    });
    expect(options?.other).toEqual({ keep: 1 });
  });

  test("does not mutate the original prompt", async () => {
    const prompt: Prompt = [{ role: "system", content: "sys" }, user("ask")];
    await transform(prompt);

    expect(prompt[0]?.providerOptions).toBeUndefined();
    expect(prompt[1]?.providerOptions).toBeUndefined();
  });

  // Wire-format test: the anthropic provider must translate the middleware's
  // providerOptions into cache_control blocks in the actual request body.
  // Pins the integration so an @ai-sdk/anthropic bump can't silently kill caching.
  test("cache_control reaches the anthropic request body", async () => {
    let body: {
      system?: Array<{ text: string; cache_control?: unknown }>;
      messages?: Array<{ content: Array<{ type: string; cache_control?: unknown }> }>;
    } = {};
    const captureFetch: typeof fetch = Object.assign(
      async (_url: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: "msg_test",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
            model: "claude-haiku-4-5-20251001",
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      { preconnect: fetch.preconnect },
    );
    const anthropic = createAnthropic({
      apiKey: "test-key-never-sent-anywhere",
      fetch: captureFetch,
    });

    const model = wrapLanguageModel({
      model: anthropic("claude-haiku-4-5-20251001"),
      middleware: anthropicPromptCache(),
    });

    await generateText({
      model,
      system: "be helpful",
      messages: [
        { role: "user", content: "first ask" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second ask" },
      ],
    });

    const ephemeral = { type: "ephemeral" };
    expect(body.system?.[0]?.cache_control).toEqual(ephemeral);
    const messageBlocks = (body.messages ?? []).map((m) => m.content.at(-1)?.cache_control);
    expect(messageBlocks).toEqual([undefined, ephemeral, ephemeral]);
  });
});
