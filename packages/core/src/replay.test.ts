import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { z } from "zod";
import type { Tool } from "./contracts/tool";
import { ToolRegistry } from "./registry";
import { buildReplay } from "./replay";

const echoTool: Tool = {
  name: "echo",
  description: "echo the message back",
  schema: z.object({ message: z.string().describe("text to echo") }),
  permission: "read",
  summarize: (input) => `echo ${(input as { message: string }).message}`,
  run: async () => ({ ok: true, output: "" }),
} as Tool;

const grumpyTool: Tool = {
  name: "grumpy",
  description: "summarize always throws",
  schema: z.object({}),
  permission: "write",
  summarize: () => {
    throw new Error("no summary for you");
  },
  run: async () => ({ ok: true, output: "" }),
} as Tool;

function registry(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(echoTool);
  r.register(grumpyTool);
  return r;
}

function toolCall(id: string, toolName: string, input: unknown) {
  return { type: "tool-call", toolCallId: id, toolName, input } as const;
}

function toolResult(id: string, toolName: string, output: unknown) {
  return { type: "tool-result", toolCallId: id, toolName, output };
}

describe("buildReplay", () => {
  test("a full conversation replays in order with live summaries and final flags", () => {
    const messages = [
      { role: "user", content: "say hi" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will echo to demonstrate." },
          toolCall("c1", "echo", { message: "hi" }),
        ],
      },
      { role: "tool", content: [toolResult("c1", "echo", { type: "text", value: "echo: hi" })] },
      { role: "assistant", content: [{ type: "text", text: "done: hi" }] },
    ] as unknown as ModelMessage[];

    expect(buildReplay(messages, registry())).toEqual([
      { kind: "user", text: "say hi" },
      { kind: "assistant", text: "I will echo to demonstrate.", final: false },
      {
        kind: "tool",
        tool: "echo",
        summary: "echo hi",
        ok: true,
        output: "echo: hi",
        permission: "read",
      },
      { kind: "assistant", text: "done: hi", final: true },
    ]);
  });

  test("error-text results replay as failed tool items", () => {
    const messages = [
      { role: "assistant", content: [toolCall("c1", "echo", { message: "x" })] },
      {
        role: "tool",
        content: [toolResult("c1", "echo", { type: "error-text", value: "it broke" })],
      },
    ] as unknown as ModelMessage[];

    expect(buildReplay(messages, registry())).toEqual([
      {
        kind: "tool",
        tool: "echo",
        summary: "echo x",
        ok: false,
        output: "it broke",
        permission: "read",
      },
    ]);
  });

  test("execution-denied results replay as denials, summary and permission intact", () => {
    const messages = [
      { role: "assistant", content: [toolCall("c1", "echo", { message: "x" })] },
      {
        role: "tool",
        content: [toolResult("c1", "echo", { type: "execution-denied", reason: "user said no" })],
      },
    ] as unknown as ModelMessage[];

    expect(buildReplay(messages, registry())).toEqual([
      {
        kind: "tool-denied",
        tool: "echo",
        summary: "echo x",
        permission: "read",
        reason: "user said no",
      },
    ]);
  });

  test("a tool no longer in the registry falls back to its name and read", () => {
    const messages = [
      { role: "assistant", content: [toolCall("c1", "gone_tool", {})] },
      { role: "tool", content: [toolResult("c1", "gone_tool", { type: "text", value: "out" })] },
    ] as unknown as ModelMessage[];

    expect(buildReplay(messages, registry())).toEqual([
      {
        kind: "tool",
        tool: "gone_tool",
        summary: "gone_tool",
        ok: true,
        output: "out",
        permission: "read",
      },
    ]);
  });

  test("a summarize that throws falls back to the tool name, not a crash", () => {
    const messages = [
      { role: "assistant", content: [toolCall("c1", "grumpy", {})] },
      { role: "tool", content: [toolResult("c1", "grumpy", { type: "text", value: "ok" })] },
    ] as unknown as ModelMessage[];

    expect(buildReplay(messages, registry())).toEqual([
      {
        kind: "tool",
        tool: "grumpy",
        summary: "grumpy",
        ok: true,
        output: "ok",
        permission: "write",
      },
    ]);
  });

  test("content-array outputs join their text parts", () => {
    const messages = [
      { role: "assistant", content: [toolCall("c1", "echo", { message: "x" })] },
      {
        role: "tool",
        content: [
          toolResult("c1", "echo", {
            type: "content",
            value: [
              { type: "text", text: "part one " },
              { type: "media", data: "…", mediaType: "image/png" },
              { type: "text", text: "part two" },
            ],
          }),
        ],
      },
    ] as unknown as ModelMessage[];

    const [item] = buildReplay(messages, registry());
    expect(item).toMatchObject({ kind: "tool", ok: true, output: "part one part two" });
  });

  test("array user content and empty texts: parts join, blanks are skipped", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "from parts" }] },
      { role: "assistant", content: [toolCall("c1", "echo", { message: "x" })] },
      { role: "tool", content: [toolResult("c1", "echo", { type: "text", value: "" })] },
      { role: "user", content: "" },
    ] as unknown as ModelMessage[];

    expect(buildReplay(messages, registry())).toEqual([
      { kind: "user", text: "from parts" },
      { kind: "tool", tool: "echo", summary: "echo x", ok: true, output: "", permission: "read" },
    ]);
  });

  test("empty history replays to nothing", () => {
    expect(buildReplay([], registry())).toEqual([]);
  });
});
