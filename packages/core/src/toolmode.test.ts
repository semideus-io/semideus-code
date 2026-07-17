import { describe, expect, test } from "bun:test";
import { ToolRegistry } from "./registry";
import { echoTool } from "./test-kit";
import {
  fallbackErrorMessage,
  fallbackResultMessage,
  parseFallbackCall,
  toolProtocolPrompt,
} from "./toolmode";

describe("toolProtocolPrompt", () => {
  test("describes every tool with its JSON schema and the call shape", () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const json = toolProtocolPrompt(registry, "json-fallback");
    expect(json).toContain("echo — echo the message back");
    expect(json).toContain('"message"');
    expect(json).toContain("```json");
    const xml = toolProtocolPrompt(registry, "xml-repair");
    expect(xml).toContain("<tool_call>");
    expect(xml).toContain("echo — echo the message back");
  });
});

describe("parseFallbackCall — json-fallback", () => {
  test("a fenced json block parses with its narration separated", () => {
    const text =
      'Reading the file first.\n```json\n{"tool": "echo", "input": {"message": "hi"}}\n```';
    expect(parseFallbackCall(text, "json-fallback")).toEqual({
      kind: "call",
      tool: "echo",
      input: { message: "hi" },
      narration: "Reading the file first.",
    });
  });

  test('a bare {"tool": …} object without fences still parses', () => {
    const text = 'On it.\n{"tool": "echo", "input": {"message": "x"}}';
    const parsed = parseFallbackCall(text, "json-fallback");
    expect(parsed).toMatchObject({ kind: "call", tool: "echo", input: { message: "x" } });
  });

  test("the last block wins when the model emits several", () => {
    const text =
      '```json\n{"tool": "first", "input": {}}\n```\nchanged my mind\n```json\n{"tool": "second", "input": {}}\n```';
    expect(parseFallbackCall(text, "json-fallback")).toMatchObject({ tool: "second" });
  });

  test("trailing commas are repaired instead of failing", () => {
    const text = '```json\n{"tool": "echo", "input": {"message": "hi",},}\n```';
    expect(parseFallbackCall(text, "json-fallback")).toMatchObject({
      kind: "call",
      input: { message: "hi" },
    });
  });

  test("a block missing the tool field is an error, not a call", () => {
    const text = '```json\n{"input": {"message": "hi"}}\n```';
    const parsed = parseFallbackCall(text, "json-fallback");
    expect(parsed.kind).toBe("error");
    expect(parsed.kind === "error" && parsed.message).toContain('"tool"');
  });

  test("unparsable JSON is an error carrying the parser's complaint", () => {
    const text = '```json\n{"tool": "echo", "input": {oops}\n```';
    const parsed = parseFallbackCall(text, "json-fallback");
    expect(parsed.kind).toBe("error");
  });

  test("plain prose is a conclusion — kind none", () => {
    expect(parseFallbackCall("All done: the tests pass.", "json-fallback")).toEqual({
      kind: "none",
    });
  });

  test("missing input defaults to an empty object", () => {
    const text = '```json\n{"tool": "echo"}\n```';
    expect(parseFallbackCall(text, "json-fallback")).toMatchObject({ kind: "call", input: {} });
  });
});

describe("parseFallbackCall — xml-repair", () => {
  test("a tool_call block parses tool and JSON input", () => {
    const text =
      'Checking.\n<tool_call>\n<tool>echo</tool>\n<input>{"message": "hi"}</input>\n</tool_call>';
    expect(parseFallbackCall(text, "xml-repair")).toEqual({
      kind: "call",
      tool: "echo",
      input: { message: "hi" },
      narration: "Checking.",
    });
  });

  test("trailing commas inside <input> are repaired", () => {
    const text = '<tool_call><tool>echo</tool><input>{"message": "hi",}</input></tool_call>';
    expect(parseFallbackCall(text, "xml-repair")).toMatchObject({
      kind: "call",
      input: { message: "hi" },
    });
  });

  test("an empty input body means an empty object", () => {
    const text = "<tool_call><tool>echo</tool><input></input></tool_call>";
    expect(parseFallbackCall(text, "xml-repair")).toMatchObject({ kind: "call", input: {} });
  });

  test("missing tags are named errors: no tool, no input", () => {
    const noTool = parseFallbackCall("<tool_call><input>{}</input></tool_call>", "xml-repair");
    expect(noTool.kind === "error" && noTool.message).toContain("<tool>");
    const noInput = parseFallbackCall("<tool_call><tool>echo</tool></tool_call>", "xml-repair");
    expect(noInput.kind === "error" && noInput.message).toContain("<input>");
  });

  test("irreparable input JSON is an error", () => {
    const text = "<tool_call><tool>echo</tool><input>{nope</input></tool_call>";
    expect(parseFallbackCall(text, "xml-repair").kind).toBe("error");
  });

  test("prose without a block is a conclusion", () => {
    expect(parseFallbackCall("Done.", "xml-repair")).toEqual({ kind: "none" });
  });
});

describe("wire messages", () => {
  test("results and errors carry their tags and status", () => {
    expect(fallbackResultMessage("echo", true, "out", false)).toBe(
      '<tool_result tool="echo" status="ok">\nout\n</tool_result>',
    );
    expect(fallbackResultMessage("echo", false, "denied: no", true)).toContain('status="denied"');
    expect(fallbackResultMessage("echo", false, "bad", false)).toContain('status="error"');
    expect(fallbackErrorMessage("missing tool")).toContain("missing tool");
  });
});
