import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "./contracts/events";
import { runTurn } from "./loop";
import { echoTool, type MockResponse, makeSession } from "./test-kit";

const JSON_CALL = 'Echoing now.\n```json\n{"tool": "echo", "input": {"message": "hi"}}\n```';
const XML_CALL =
  'Echoing now.\n<tool_call>\n<tool>echo</tool>\n<input>{"message": "hi"}</input>\n</tool_call>';
const DONE: MockResponse = { content: [{ type: "text", text: "Done." }], finishReason: "stop" };

function textResponse(text: string): MockResponse {
  // Fallback modes finish with reason "stop" — there are no native tool calls.
  return { content: [{ type: "text", text }], finishReason: "stop" };
}

describe("runTurn in json-fallback mode", () => {
  test("a fenced call executes through the gate and the result returns as user text", async () => {
    const events: AgentEvent[] = [];
    const prompts: unknown[] = [];
    const session = makeSession({
      responses: [textResponse(JSON_CALL), DONE],
      events,
      prompts,
      toolMode: "json-fallback",
    });

    await runTurn(session, "please echo hi");

    // Wire shape: user, assistant(text with block), user(<tool_result>), assistant.
    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const resultMsg = session.messages[2];
    expect(typeof resultMsg?.content).toBe("string");
    expect(resultMsg?.content).toContain('<tool_result tool="echo" status="ok">');
    expect(resultMsg?.content).toContain("echo: hi");

    // Events look exactly like a native run: start, end ok, conclusion final.
    expect(events.some((e) => e.type === "tool-start" && e.tool === "echo")).toBe(true);
    expect(events.some((e) => e.type === "tool-end" && e.ok)).toBe(true);
    const texts = events.flatMap((e) => (e.type === "assistant-text" ? [e] : []));
    expect(texts[0]?.final).toBe(false);
    expect(texts[0]?.text).toBe("Echoing now."); // narration without the raw block
    expect(texts.at(-1)?.final).toBe(true);

    // The second model call sees the protocol result in its prompt.
    expect(JSON.stringify(prompts[1])).toContain("tool_result");
    // And the system prompt carried the protocol section.
    expect(JSON.stringify(prompts[0])).toContain("no native tool support");

    // Decision log records the call like any other.
    expect(session.decisions().map((d) => d.kind)).toEqual(["tool_call", "conclusion"]);
  });

  test("a malformed block costs one repair round-trip, then the corrected call runs", async () => {
    const events: AgentEvent[] = [];
    const session = makeSession({
      responses: [
        textResponse('```json\n{"tool": "echo", "input": {oops}\n```'),
        textResponse(JSON_CALL),
        DONE,
      ],
      events,
      toolMode: "json-fallback",
    });

    await runTurn(session, "echo hi");

    // The corrective message went back as user text with the error tag.
    const corrective = session.messages.find(
      (m) => m.role === "user" && String(m.content).startsWith("<tool_call_error>"),
    );
    expect(corrective).toBeDefined();
    expect(events.some((e) => e.type === "notice" && e.text.includes("re-emit"))).toBe(true);
    // The repaired call still executed.
    expect(events.some((e) => e.type === "tool-end" && e.ok)).toBe(true);
  });

  test("an unknown tool name flows back as an error result the model can react to", async () => {
    const session = makeSession({
      responses: [textResponse('```json\n{"tool": "no_such_tool", "input": {}}\n```'), DONE],
      toolMode: "json-fallback",
    });

    await runTurn(session, "go");

    const resultMsg = session.messages.find(
      (m) => m.role === "user" && String(m.content).startsWith("<tool_result"),
    );
    expect(String(resultMsg?.content)).toContain('status="error"');
    expect(String(resultMsg?.content)).toContain("unknown tool");
  });

  test("denial still goes through the gate and returns as a denied result", async () => {
    const events: AgentEvent[] = [];
    const session = makeSession({
      responses: [textResponse(JSON_CALL), DONE],
      tool: echoTool("execute"),
      policy: { execute: "deny" },
      events,
      toolMode: "json-fallback",
    });

    await runTurn(session, "echo hi");

    expect(events.some((e) => e.type === "tool-denied")).toBe(true);
    const resultMsg = session.messages.find(
      (m) => m.role === "user" && String(m.content).startsWith("<tool_result"),
    );
    expect(String(resultMsg?.content)).toContain('status="denied"');
  });

  test("invalid input is refused by the schema, not executed", async () => {
    const events: AgentEvent[] = [];
    const session = makeSession({
      responses: [textResponse('```json\n{"tool": "echo", "input": {"message": 42}}\n```'), DONE],
      events,
      toolMode: "json-fallback",
    });

    await runTurn(session, "echo");

    // Validation trips before any tool event (native behaves the same); the
    // schema complaint returns to the model as an error result.
    expect(events.some((e) => e.type === "tool-start")).toBe(false);
    const resultMsg = session.messages.find(
      (m) => m.role === "user" && String(m.content).startsWith("<tool_result"),
    );
    expect(String(resultMsg?.content)).toContain('status="error"');
    expect(String(resultMsg?.content)).toContain("invalid input");
  });
});

describe("runTurn in xml-repair mode", () => {
  test("an xml call executes and concludes like the json tier", async () => {
    const events: AgentEvent[] = [];
    const prompts: unknown[] = [];
    const session = makeSession({
      responses: [textResponse(XML_CALL), DONE],
      events,
      prompts,
      toolMode: "xml-repair",
    });

    await runTurn(session, "echo hi");

    expect(events.some((e) => e.type === "tool-end" && e.ok)).toBe(true);
    expect(JSON.stringify(prompts[0])).toContain("<tool_call>");
    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  test("repairable input (trailing comma) executes without a round-trip", async () => {
    const events: AgentEvent[] = [];
    const session = makeSession({
      responses: [
        textResponse('<tool_call><tool>echo</tool><input>{"message": "hi",}</input></tool_call>'),
        DONE,
      ],
      events,
      toolMode: "xml-repair",
    });

    await runTurn(session, "echo hi");

    expect(events.some((e) => e.type === "tool-end" && e.ok)).toBe(true);
    expect(events.some((e) => e.type === "notice" && e.text.includes("re-emit"))).toBe(false);
  });

  test("plain prose concludes the turn — no phantom calls", async () => {
    const events: AgentEvent[] = [];
    const session = makeSession({
      responses: [textResponse("The answer is 4.")],
      events,
      toolMode: "xml-repair",
    });

    await runTurn(session, "2+2?");

    expect(events.some((e) => e.type === "tool-start")).toBe(false);
    const texts = events.flatMap((e) => (e.type === "assistant-text" ? [e] : []));
    expect(texts).toEqual([{ type: "assistant-text", text: "The answer is 4.", final: true }]);
  });
});
