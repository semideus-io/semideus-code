import type { LanguageModelMiddleware } from "ai";

type TransformParams = NonNullable<LanguageModelMiddleware["transformParams"]>;
type CallOptions = Awaited<ReturnType<TransformParams>>;
type PromptMessage = CallOptions["prompt"][number];

/**
 * Anthropic prompt caching as model middleware, so the loop stays
 * provider-agnostic. Marks cache breakpoints on:
 *
 * - the system message — caches the tools + system prefix once per session
 * - the last two non-system messages — a moving breakpoint, so each agent step
 *   re-reads the conversation prefix (~0.1× input price) instead of re-buying it
 *
 * Three breakpoints total, within Anthropic's limit of four. Non-Anthropic
 * providers never see this middleware (see factory.ts).
 */
export function anthropicPromptCache(): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => {
      const lastTwo = params.prompt.length - 2;
      const prompt = params.prompt.map((message, i) => {
        const marked = message.role === "system" || i >= lastTwo;
        return marked ? withEphemeralCache(message) : message;
      });
      return { ...params, prompt };
    },
  };
}

function withEphemeralCache(message: PromptMessage): PromptMessage {
  const anthropic = message.providerOptions?.anthropic ?? {};
  return {
    ...message,
    providerOptions: {
      ...message.providerOptions,
      anthropic: { ...anthropic, cacheControl: { type: "ephemeral" } },
    },
  };
}
