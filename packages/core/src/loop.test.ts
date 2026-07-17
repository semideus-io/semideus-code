import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import type { AgentEvent } from "./contracts/events";
import type { ModelSpec } from "./contracts/provider";
import type { Tool } from "./contracts/tool";
import { runTurn } from "./loop";
import { PermissionGate, type PermissionPolicy } from "./permissions";
import { ToolRegistry } from "./registry";
import { Session } from "./session";
import { SessionStore } from "./store";

const echoSchema = z.object({ message: z.string().describe("text to echo") });

function echoTool(permission: Tool["permission"] = "read"): Tool {
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

type MockResponse = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
  >;
  finishReason: "stop" | "tool-calls";
  /** Emit an error part after the content instead of finishing the stream. */
  streamError?: string;
};

type MockUsage = { total: number; cacheRead?: number; cacheWrite?: number };

type ModelStream = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"];
type StreamPart = ModelStream extends ReadableStream<infer P> ? P : never;

/** V3 spec stream parts for one scripted response; text arrives in two deltas. */
function streamParts(res: MockResponse | undefined, usage?: MockUsage): StreamPart[] {
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
  if (res?.streamError) {
    parts.push({ type: "error", error: new Error(res.streamError) });
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

function makeSession(opts: {
  responses: MockResponse[];
  tool?: Tool;
  policy?: Partial<PermissionPolicy>;
  events?: AgentEvent[];
  prompts?: unknown[];
  usage?: MockUsage;
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
    toolMode: "native",
    costPerMTok: { in: 1, out: 2 },
  };

  const registry = new ToolRegistry();
  registry.register(opts.tool ?? echoTool());

  const gate = new PermissionGate({
    read: "allow",
    write: "ask",
    execute: "ask",
    network: "ask",
    ...opts.policy,
  });

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

const toolCallThenDone: MockResponse[] = [
  {
    content: [
      { type: "text", text: "I will echo to demonstrate the loop." },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "echo",
        input: JSON.stringify({ message: "hi" }),
      },
    ],
    finishReason: "tool-calls",
  },
  { content: [{ type: "text", text: "Done — the echo worked." }], finishReason: "stop" },
];

describe("runTurn", () => {
  test("executes a tool call, feeds the result back, and concludes", async () => {
    const events: AgentEvent[] = [];
    const session = makeSession({ responses: toolCallThenDone, events });

    await runTurn(session, "please echo hi");

    const roles = session.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);

    const kinds = session.decisions().map((d) => d.kind);
    expect(kinds).toEqual(["tool_call", "conclusion"]);
    expect(session.decisions()[0]?.rationale).toContain("echo");

    expect(events.some((e) => e.type === "tool-end" && e.ok)).toBe(true);
    expect(events.at(-1)?.type).toBe("turn-end");

    // narration alongside tool calls is non-final; the conclusion is final
    const texts = events.flatMap((e) => (e.type === "assistant-text" ? [e] : []));
    expect(texts.map((e) => e.final)).toEqual([false, true]);

    // renderers get the permission class with every tool event
    const starts = events.flatMap((e) => (e.type === "tool-start" ? [e] : []));
    expect(starts[0]?.permission).toBe("read");

    // two model calls × (10 in + 5 out) at $1/$2 per MTok
    expect(session.usage.inputTokens).toBe(20);
    expect(session.usage.outputTokens).toBe(10);
    expect(session.usage.costUsd).toBeCloseTo((20 / 1e6) * 1 + (10 / 1e6) * 2, 10);
  });

  test("denied tools return a denial to the model instead of running", async () => {
    const events: AgentEvent[] = [];
    const prompts: unknown[] = [];
    const session = makeSession({
      responses: toolCallThenDone,
      tool: echoTool("execute"),
      policy: { execute: "deny" },
      events,
      prompts,
    });

    await runTurn(session, "please echo hi");

    expect(events.some((e) => e.type === "tool-denied")).toBe(true);
    // the second model call must see the denial in its prompt
    expect(JSON.stringify(prompts[1])).toContain("denied");
  });

  test("cache reads and writes are tracked and priced at their discounted rates", async () => {
    const session = makeSession({
      responses: [{ content: [{ type: "text", text: "done" }], finishReason: "stop" }],
      usage: { total: 50, cacheRead: 30, cacheWrite: 10 },
    });

    await runTurn(session, "hi");

    expect(session.usage.inputTokens).toBe(50);
    expect(session.usage.cacheReadTokens).toBe(30);
    expect(session.usage.cacheWriteTokens).toBe(10);
    // 10 uncached + 10 written ×1.25 + 30 read ×0.1 at $1/MTok in, 5 out at $2/MTok
    expect(session.usage.costUsd).toBeCloseTo((10 + 12.5 + 3) / 1e6 + (5 * 2) / 1e6, 12);
  });

  test("turn usage resets per turn while session usage accumulates", async () => {
    const events: AgentEvent[] = [];
    const session = makeSession({ responses: toolCallThenDone, events });

    await runTurn(session, "first");
    await runTurn(session, "second");

    const ends = events.flatMap((e) => (e.type === "turn-end" ? [e] : []));
    expect(ends).toHaveLength(2);
    // turn 1 = two model calls (tool call + conclusion), turn 2 = one (the mock
    // keeps serving its last scripted response); 10 input tokens per call
    expect(ends[1]?.turn.inputTokens).toBe(10);
    expect(ends[1]?.session.inputTokens).toBe(30);
  });

  test("session persists after the turn", async () => {
    const session = makeSession({ responses: toolCallThenDone });
    await runTurn(session, "please echo hi");
    const loaded = session.store.loadSession(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.messages.length).toBe(4);
    expect(loaded?.title).toContain("please echo hi");
  });

  test("streams assistant deltas that concatenate to the assistant text", async () => {
    const events: AgentEvent[] = [];
    const session = makeSession({ responses: toolCallThenDone, events });

    await runTurn(session, "please echo hi");

    const deltas = events.flatMap((e) => (e.type === "assistant-delta" ? [e.text] : []));
    const texts = events.flatMap((e) => (e.type === "assistant-text" ? [e.text] : []));
    // two responses, each streamed in two chunks
    expect(deltas).toHaveLength(4);
    expect(deltas.join("")).toBe(texts.join(""));

    // the live region hears about text before any tool executes
    const firstDelta = events.findIndex((e) => e.type === "assistant-delta");
    const firstToolStart = events.findIndex((e) => e.type === "tool-start");
    expect(firstDelta).toBeGreaterThan(-1);
    expect(firstDelta).toBeLessThan(firstToolStart);
  });

  test("a mid-stream error becomes an error event, tracking nothing", async () => {
    const events: AgentEvent[] = [];
    const session = makeSession({
      responses: [
        {
          content: [{ type: "text", text: "half an answer" }],
          finishReason: "stop",
          streamError: "connection reset",
        },
      ],
      events,
    });

    await runTurn(session, "hi");

    const error = events.find((e) => e.type === "error");
    expect(error?.type === "error" && error.message).toContain("connection reset");
    // the failed step leaves no trace: no usage, no assistant message, no conclusion
    expect(session.usage.inputTokens).toBe(0);
    expect(session.messages.map((m) => m.role)).toEqual(["user"]);
    expect(events.some((e) => e.type === "notice")).toBe(true);
    expect(events.at(-1)?.type).toBe("turn-end");
  });

  test("unknown tool calls get exactly one error result, not a duplicate answer", async () => {
    const responses: MockResponse[] = [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "nonexistent",
            input: JSON.stringify({}),
          },
        ],
        finishReason: "tool-calls",
      },
      { content: [{ type: "text", text: "ok" }], finishReason: "stop" },
    ];
    const session = makeSession({ responses });
    await runTurn(session, "go");

    // the SDK answers invalid calls itself; the loop must not answer them again
    const toolResults = session.messages
      .filter((m) => m.role === "tool")
      .flatMap((m) => m.content as Array<{ toolCallId?: string }>);
    expect(toolResults.filter((p) => p.toolCallId === "call-1")).toHaveLength(1);
    expect(JSON.stringify(session.messages)).toContain("nonexistent");
  });
});
