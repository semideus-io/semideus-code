import type { ModelMessage } from "ai";
import type { ReplayItem } from "./contracts/replay";
import type { ToolRegistry } from "./registry";
import { ERROR_TAG, RESULT_TAG } from "./toolmode";

interface CallInfo {
  toolName: string;
  input: unknown;
}

interface TextLike {
  type: string;
  text?: string;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as TextLike[])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

interface ToolCallLike {
  type: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

function toolCallsOf(content: unknown): ToolCallLike[] {
  if (!Array.isArray(content)) return [];
  return (content as ToolCallLike[]).filter((part) => part?.type === "tool-call");
}

interface ToolResultLike {
  type: string;
  toolCallId: string;
  toolName: string;
  output?: { type: string; value?: unknown; reason?: string };
}

function outcomeOf(part: ToolResultLike): { ok: boolean; text: string; deniedReason?: string } {
  const output = part.output;
  if (!output) return { ok: false, text: "" };
  if (output.type === "execution-denied") {
    return { ok: false, text: "", deniedReason: output.reason ?? "denied" };
  }
  if (output.type === "content" && Array.isArray(output.value)) {
    const text = (output.value as TextLike[])
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    return { ok: true, text };
  }
  const ok = output.type === "text" || output.type === "json";
  const text = typeof output.value === "string" ? output.value : JSON.stringify(output.value ?? "");
  return { ok, text };
}

/**
 * Rebuilds what a resumed session's transcript would have shown, straight
 * from the stored ModelMessage[] — no separate replay log to keep in sync.
 * Tool-result parts carry only a toolCallId; the matching tool-call part
 * (same id, earlier in an assistant message) supplies the toolName/input
 * needed to regenerate the summary via the same tool.summarize() the live
 * loop used, so a replayed line reads the same as it did live.
 */
export function buildReplay(messages: ModelMessage[], registry: ToolRegistry): ReplayItem[] {
  const items: ReplayItem[] = [];
  const calls = new Map<string, CallInfo>();

  for (const message of messages) {
    if (message.role === "user") {
      const text = textOf(message.content);
      // Fallback-mode protocol traffic is user-role on the wire but not the
      // human speaking — replay skips it rather than misattributing it.
      const protocol = text.startsWith(RESULT_TAG) || text.startsWith(ERROR_TAG);
      if (text && !protocol) items.push({ kind: "user", text });
      continue;
    }
    if (message.role === "assistant") {
      const toolCalls = toolCallsOf(message.content);
      for (const call of toolCalls) {
        calls.set(call.toolCallId, { toolName: call.toolName, input: call.input });
      }
      const text = textOf(message.content);
      if (text) items.push({ kind: "assistant", text, final: toolCalls.length === 0 });
      continue;
    }
    if (message.role === "tool" && Array.isArray(message.content)) {
      for (const part of message.content as ToolResultLike[]) {
        if (part?.type !== "tool-result") continue;
        const call = calls.get(part.toolCallId);
        const tool = call ? registry.get(call.toolName) : undefined;
        let summary = part.toolName;
        if (tool && call) {
          try {
            summary = tool.summarize(call.input as never);
          } catch {
            summary = part.toolName;
          }
        }
        const permission = tool?.permission ?? "read";
        const outcome = outcomeOf(part);
        if (outcome.deniedReason !== undefined) {
          items.push({
            kind: "tool-denied",
            tool: part.toolName,
            summary,
            permission,
            reason: outcome.deniedReason,
          });
        } else {
          items.push({
            kind: "tool",
            tool: part.toolName,
            summary,
            ok: outcome.ok,
            output: outcome.text,
            permission,
          });
        }
      }
    }
  }
  return items;
}
