import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AgentEvent } from "./contracts/events";
import type { Tool, ToolResult } from "./contracts/tool";
import { runTurn } from "./loop";
import type { ApprovalRequest } from "./permissions";
import { echoTool, type MockResponse, makeSession } from "./test-kit";

async function until(cond: () => boolean, timeoutMs = 1_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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

/** A tool that returns whatever artifacts a test needs, so the decision log can be checked. */
function artifactTool(artifacts: ToolResult["artifacts"], output = "done"): Tool {
  return {
    name: "edit_file",
    description: "stand-in for a mutating tool",
    schema: z.object({ path: z.string().describe("file to touch") }),
    permission: "write",
    summarize: () => "edit a.ts",
    run: async () => ({ ok: true, output, artifacts }),
  } as Tool;
}

const callArtifactTool: MockResponse[] = [
  {
    content: [
      { type: "text", text: "Renaming for clarity." },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "edit_file",
        input: JSON.stringify({ path: "a.ts" }),
      },
    ],
    finishReason: "tool-calls",
  },
  { content: [{ type: "text", text: "Done." }], finishReason: "stop" },
];

describe("decision artifacts", () => {
  test("an edit's decision carries its diff — the evidence /why renders", async () => {
    const session = makeSession({
      responses: callArtifactTool,
      tool: artifactTool({ path: "a.ts", diff: "--- a\n+++ b\n-old\n+new" }),
      policy: { write: "allow" },
    });

    await runTurn(session, "rename it");

    const [edit] = session.decisions();
    expect(edit?.kind).toBe("edit");
    expect(edit?.artifact?.diff).toContain("+new");
    // A diff is not command output — the panel must not label it as such.
    expect(edit?.artifact?.output).toBeUndefined();
  });

  test("a command's decision carries what it printed, even on success", async () => {
    const session = makeSession({
      responses: callArtifactTool,
      tool: artifactTool({ command: "bun test" }, "7 pass\n0 fail"),
      policy: { write: "allow" },
    });

    await runTurn(session, "run the tests");

    expect(session.decisions()[0]?.artifact?.output).toBe("7 pass\n0 fail");
  });

  test("read-class steps store no artifact — the log stays a log", async () => {
    const session = makeSession({ responses: toolCallThenDone });

    await runTurn(session, "please echo hi");

    expect(session.decisions()[0]?.artifact).toBeUndefined();
  });

  test("a huge artifact is truncated at write time, keeping head and tail", async () => {
    const giant = Array.from({ length: 4_000 }, (_, i) => `line ${i}`).join("\n");
    const session = makeSession({
      responses: callArtifactTool,
      tool: artifactTool({ command: "noisy" }, giant),
      policy: { write: "allow" },
    });

    await runTurn(session, "run it");

    const stored = session.decisions()[0]?.artifact?.output ?? "";
    expect(stored.length).toBeLessThan(giant.length);
    expect(stored).toContain("line 0");
    expect(stored).toContain("line 3999");
    expect(stored).toContain("truncated");
  });
});

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

  test("abort mid-stream keeps the partial text and ends the turn cleanly", async () => {
    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const session = makeSession({
      responses: [
        { content: [{ type: "text", text: "half an answer" }], finishReason: "stop", hang: true },
      ],
      events,
    });

    const turn = runTurn(session, "hi", { signal: controller.signal });
    await until(() => events.some((e) => e.type === "assistant-delta"));
    controller.abort();
    await turn;

    // partial text lands in history and transcript as narration, never as a conclusion
    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const texts = events.flatMap((e) => (e.type === "assistant-text" ? [e] : []));
    expect(texts).toHaveLength(1);
    expect(texts[0]?.final).toBe(false);
    expect(texts[0]?.text).toBe("half an answer");

    // the aborted step tracks no usage, logs no decision, but persists and closes the turn
    expect(session.usage.inputTokens).toBe(0);
    expect(session.decisions()).toHaveLength(0);
    const notice = events.find((e) => e.type === "notice");
    expect(notice?.type === "notice" && notice.text).toContain("interrupted");
    expect(events.at(-1)?.type).toBe("turn-end");
    expect(session.store.loadSession(session.id)?.messages).toHaveLength(2);
  });

  test("abort during a tool batch answers unrun calls and skips the next model call", async () => {
    const events: AgentEvent[] = [];
    const prompts: unknown[] = [];
    const controller = new AbortController();
    // the first call aborts the turn mid-run; the second call must never execute
    let runs = 0;
    const tool: Tool = {
      ...echoTool(),
      run: async () => {
        runs++;
        controller.abort();
        return { ok: true, output: "echo: hi" };
      },
    };
    const session = makeSession({
      responses: [
        {
          content: [
            { type: "text", text: "Two echoes coming." },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "echo",
              input: JSON.stringify({ message: "one" }),
            },
            {
              type: "tool-call",
              toolCallId: "call-2",
              toolName: "echo",
              input: JSON.stringify({ message: "two" }),
            },
          ],
          finishReason: "tool-calls",
        },
        { content: [{ type: "text", text: "never sent" }], finishReason: "stop" },
      ],
      tool,
      events,
      prompts,
    });

    await runTurn(session, "echo twice", { signal: controller.signal });

    expect(runs).toBe(1);
    expect(prompts).toHaveLength(1);
    // both calls carry a result so the stored history stays provider-valid
    const toolMessage = session.messages.find((m) => m.role === "tool");
    const parts = toolMessage?.content as Array<{ toolCallId: string; output: { type: string } }>;
    expect(parts.map((p) => p.toolCallId)).toEqual(["call-1", "call-2"]);
    expect(parts[0]?.output.type).toBe("text");
    expect(parts[1]?.output.type).toBe("execution-denied");
    // only the executed call reaches the decision log; no conclusion is logged
    expect(session.decisions().map((d) => d.kind)).toEqual(["tool_call"]);
    const notice = events.find((e) => e.type === "notice");
    expect(notice?.type === "notice" && notice.text).toContain("interrupted");
  });

  test("an already-aborted signal ends the turn before any model call", async () => {
    const events: AgentEvent[] = [];
    const prompts: unknown[] = [];
    const controller = new AbortController();
    controller.abort();
    const session = makeSession({ responses: toolCallThenDone, events, prompts });

    await runTurn(session, "hi", { signal: controller.signal });

    expect(prompts).toHaveLength(0);
    expect(session.messages.map((m) => m.role)).toEqual(["user"]);
    const notice = events.find((e) => e.type === "notice");
    expect(notice?.type === "notice" && notice.text).toContain("interrupted");
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
