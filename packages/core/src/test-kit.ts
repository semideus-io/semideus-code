import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import type { AgentEvent } from "./contracts/events";
import type { ModelSpec, ToolMode } from "./contracts/provider";
import type { Tool } from "./contracts/tool";
import { type ApprovalPrompter, PermissionGate, type PermissionPolicy } from "./permissions";
import { ToolRegistry } from "./registry";
import { Session } from "./session";
import { SessionStore } from "./store";

/**
 * Shared fixtures for loop-level tests (loop.test.ts, loop-fallback.test.ts):
 * a scripted V3 mock model streaming text in two deltas per response, plus a
 * fully wired in-memory Session. Not a test suite itself.
 */

const echoSchema = z.object({ message: z.string().describe("text to echo") });

export function echoTool(permission: Tool["permission"] = "read"): Tool {
  return {
    name: "echo",
    description: "echo the message back",
    schema: echoSchema,
    permission,
    summarize: (input) => `echo ${(input as { message: string }).message}`,
    run: async (input) => ({
      ok: true,
      output: `echo: ${(input as { message: string }).message}`,
    }),
  } as Tool;
}

export type MockResponse = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
  >;
  finishReason: "stop" | "tool-calls";
  /** Emit an error part after the content instead of finishing the stream. */
  streamError?: string;
  /**
   * Emit the content, then keep the stream open until the call's abortSignal
   * fires, then fail it like an aborted fetch does. For interrupt tests.
   */
  hang?: boolean;
};

export type MockUsage = { total: number; cacheRead?: number; cacheWrite?: number };

type ModelStream = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"];
type StreamPart = ModelStream extends ReadableStream<infer P> ? P : never;

/** V3 spec stream parts for one scripted response; text arrives in two deltas. */
export function streamParts(res: MockResponse | undefined, usage?: MockUsage): StreamPart[] {
  const parts: StreamPart[] = [{ type: "stream-start", warnings: [] }];
  let textId = 0;
  for (const piece of res?.content ?? []) {
    if (piece.type === "text") {
      const id = `text-${textId++}`;
      parts.push({ type: "text-start", id });
      const mid = Math.ceil(piece.text.length / 2);
      for (const delta of [piece.text.slice(0, mid), piece.text.slice(mid)]) {
        if (delta) parts.push({ type: "text-delta", id, delta });
      }
      parts.push({ type: "text-end", id });
    } else {
      parts.push(piece);
    }
  }
  if (res?.streamError || res?.hang) {
    if (res.streamError) parts.push({ type: "error", error: new Error(res.streamError) });
    return parts;
  }
  parts.push({
    type: "finish",
    finishReason: { unified: res?.finishReason ?? "stop", raw: undefined },
    usage: {
      inputTokens: {
        total: usage?.total ?? 10,
        noCache: undefined,
        cacheRead: usage?.cacheRead,
        cacheWrite: usage?.cacheWrite,
      },
      outputTokens: { total: 5, text: undefined, reasoning: undefined },
    },
  });
  return parts;
}

export function makeSession(opts: {
  responses: MockResponse[];
  tool?: Tool;
  policy?: Partial<PermissionPolicy>;
  events?: AgentEvent[];
  prompts?: unknown[];
  usage?: MockUsage;
  prompter?: ApprovalPrompter;
  toolMode?: ToolMode;
}): Session {
  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      opts.prompts?.push(options.prompt);
      const res = opts.responses[Math.min(call, opts.responses.length - 1)];
      call++;
      const parts = streamParts(res, opts.usage);
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            if (res?.hang) {
              // Stay open; fail like an aborted fetch when the signal fires.
              const fail = () => controller.error(new DOMException("aborted", "AbortError"));
              if (options.abortSignal?.aborted) fail();
              else options.abortSignal?.addEventListener("abort", fail, { once: true });
              return;
            }
            controller.close();
          },
        }),
      };
    },
  });

  const spec: ModelSpec = {
    id: "mock",
    model: model as unknown as ModelSpec["model"],
    modelName: "mock-model",
    contextWindow: 8_000,
    toolMode: opts.toolMode ?? "native",
    costPerMTok: { in: 1, out: 2 },
  };

  const registry = new ToolRegistry();
  registry.register(opts.tool ?? echoTool());

  const gate = new PermissionGate(
    {
      read: "allow",
      write: "ask",
      execute: "ask",
      network: "ask",
      ...opts.policy,
    },
    opts.prompter,
  );

  return new Session({
    cwd: process.cwd(),
    model: spec,
    registry,
    gate,
    store: new SessionStore(":memory:"),
    onEvent: opts.events ? (e) => opts.events?.push(e) : undefined,
    config: { maxSteps: 5 },
  });
}
