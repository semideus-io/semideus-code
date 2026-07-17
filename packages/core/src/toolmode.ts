import { z } from "zod";
import type { ToolMode } from "./contracts/provider";
import type { ToolRegistry } from "./registry";

/**
 * Fallback tool protocol (PLAN §5): models without native tool calling get
 * the tools described in the prompt and answer with one call block per step.
 * Results return as user-message text tagged <tool_result>. Everything still
 * flows through the loop's executeCall — same validation, same gate.
 */

/** Result-message prefix — also what replay filters out of the "user" role. */
export const RESULT_TAG = "<tool_result";
export const ERROR_TAG = "<tool_call_error>";

export type FallbackParse =
  | { kind: "none" }
  | { kind: "call"; tool: string; input: unknown; narration: string }
  | { kind: "error"; message: string; narration: string };

function schemaLine(registry: ToolRegistry): string {
  return registry
    .list()
    .map((tool) => {
      const schema = z.toJSONSchema(tool.schema) as Record<string, unknown>;
      delete schema.$schema;
      return `- ${tool.name} — ${tool.description}\n  input schema: ${JSON.stringify(schema)}`;
    })
    .join("\n");
}

const JSON_SHAPE = `To call a tool, end your message with exactly one fenced block:
\`\`\`json
{"tool": "<tool name>", "input": { ... }}
\`\`\``;

const XML_SHAPE = `To call a tool, end your message with exactly one block in THIS exact
XML format — never a \`\`\`json fence, never a bare JSON object, never an invented result:
<tool_call>
<tool>read_file</tool>
<input>{"path": "some/file.ts"}</input>
</tool_call>
The <tool> body is the tool's name; the <input> body is JSON matching the tool's
input schema. You never write tool output yourself — it arrives in the next message.`;

/** Appended to the system prompt when toolMode is not native. */
export function toolProtocolPrompt(registry: ToolRegistry, mode: ToolMode): string {
  const shape = mode === "xml-repair" ? XML_SHAPE : JSON_SHAPE;
  return `## Tool calls (no native tool support)
${shape}

One call per message, nothing after the block. The result arrives in the next
user message as ${RESULT_TAG} …>; a ${ERROR_TAG} message means your block could
not be parsed — fix exactly what it reports and re-emit. When the task is done,
answer in plain prose with no call block.

Available tools:
${schemaLine(registry)}`;
}

/** Common weak-model JSON damage that is safe to undo mechanically. */
function repairJson(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .replace(/,\s*([}\]])/g, "$1");
}

function parseJsonMode(text: string): FallbackParse {
  // Prefer the last fenced json block; fall back to a bare {"tool": …} object.
  // Narration is everything around the block — models chatter after it too.
  const fences = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)];
  const lastFence = fences.at(-1);
  let raw = lastFence?.[1];
  let narration = lastFence
    ? (text.slice(0, lastFence.index) + text.slice(lastFence.index + lastFence[0].length)).trim()
    : text;
  if (raw === undefined) {
    const start = text.lastIndexOf('{"tool"');
    if (start === -1) return { kind: "none" };
    const end = text.lastIndexOf("}");
    if (end <= start) return { kind: "none" };
    raw = text.slice(start, end + 1);
    narration = (text.slice(0, start) + text.slice(end + 1)).trim();
  }
  try {
    const value = JSON.parse(repairJson(raw)) as { tool?: unknown; input?: unknown };
    if (typeof value.tool !== "string" || value.tool.length === 0) {
      return {
        kind: "error",
        narration,
        message: 'the JSON block needs a string "tool" field naming the tool',
      };
    }
    return { kind: "call", tool: value.tool, input: value.input ?? {}, narration };
  } catch (err) {
    return {
      kind: "error",
      narration,
      message: `the JSON block does not parse: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function parseXmlMode(text: string): FallbackParse {
  const blocks = [...text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/gi)];
  const lastBlock = blocks.at(-1);
  const body = lastBlock?.[1];
  if (lastBlock === undefined || body === undefined) return { kind: "none" };
  const narration = (
    text.slice(0, lastBlock.index) + text.slice(lastBlock.index + lastBlock[0].length)
  ).trim();

  const tool = /<tool>\s*([\s\S]*?)\s*<\/tool>/i.exec(body)?.[1]?.trim();
  if (!tool) {
    return { kind: "error", narration, message: "the <tool_call> block is missing a <tool> tag" };
  }
  const rawInput = /<input>([\s\S]*?)<\/input>/i.exec(body)?.[1];
  if (rawInput === undefined) {
    return { kind: "error", narration, message: "the <tool_call> block is missing an <input> tag" };
  }
  try {
    const input = rawInput.trim() === "" ? {} : (JSON.parse(repairJson(rawInput)) as unknown);
    return { kind: "call", tool, input, narration };
  } catch (err) {
    return {
      kind: "error",
      narration,
      message: `the <input> body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** One lenient pass over the step's text; never throws. */
export function parseFallbackCall(text: string, mode: ToolMode): FallbackParse {
  if (mode === "xml-repair") return parseXmlMode(text);
  return parseJsonMode(text);
}

/** How a tool outcome goes back to a fallback-mode model: as user-role text. */
export function fallbackResultMessage(
  tool: string,
  ok: boolean,
  output: string,
  denied: boolean,
): string {
  const status = denied ? "denied" : ok ? "ok" : "error";
  return `${RESULT_TAG} tool="${tool}" status="${status}">\n${output}\n</tool_result>`;
}

/** How a parse failure goes back: name the damage, demand a re-emit. */
export function fallbackErrorMessage(message: string): string {
  return `${ERROR_TAG} Your tool call could not be used: ${message}. Re-emit the corrected block and nothing else.</tool_call_error>`;
}
