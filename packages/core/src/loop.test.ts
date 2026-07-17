import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "./contracts/events";
import type { Tool } from "./contracts/tool";
import { runTurn } from "./loop";
import type { ApprovalRequest } from "./permissions";
import { echoTool, type MockResponse, makeSession } from "./test-kit";

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

  test("the approval prompt carries the tool's preview", async () => {
    const requests: ApprovalRequest[] = [];
    const previewTool: Tool = {
      ...echoTool("write"),
      preview: async (input) => ({ diff: `+${(input as { message: string }).message}` }),
    };
    const session = makeSession({
      responses: toolCallThenDone,
      tool: previewTool,
      prompter: async (req) => {
        requests.push(req);
        return "allow";
      },
    });

    await runTurn(session, "please echo hi");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.preview).toEqual({ diff: "+hi" });
    // approved, so the tool actually ran
    expect(JSON.stringify(session.messages)).toContain("echo: hi");
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
