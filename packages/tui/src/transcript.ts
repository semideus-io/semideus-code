import type {
  AgentEvent,
  ApprovalDecision,
  PermissionClass,
  ReplayItem,
  ToolArtifacts,
  UsageTotals,
} from "@semideus/core";

/**
 * One finished line (or block) of the conversation. Items are append-only and
 * rendered exactly once inside Ink's <Static> — everything that can still
 * change (streaming text, the pending approval) lives outside the transcript.
 */
export type TranscriptItem =
  | { kind: "banner"; headline: string; lines: string[] }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; final: boolean }
  | { kind: "tool-start"; tool: string; summary: string; permission: PermissionClass }
  | {
      kind: "tool-end";
      tool: string;
      ok: boolean;
      output: string;
      permission: PermissionClass;
      artifacts?: ToolArtifacts;
    }
  | { kind: "denied"; tool: string; reason: string }
  | { kind: "approval"; tool: string; decision: ApprovalDecision }
  | { kind: "notice"; text: string }
  | { kind: "error"; text: string }
  | { kind: "cost"; turn: UsageTotals; session: UsageTotals }
  | { kind: "info"; lines: string[] };

/**
 * Map a core event to its transcript item. Live parts return null: deltas
 * feed the live region and are superseded by the assistant-text event;
 * turn-start renders nothing. user/info/approval/banner items come from the
 * app itself, not from events.
 */
export function transcriptItem(event: AgentEvent): TranscriptItem | null {
  switch (event.type) {
    case "turn-start":
    case "assistant-delta":
      return null;
    case "assistant-text":
      return { kind: "assistant", text: event.text, final: event.final };
    case "tool-start":
      return {
        kind: "tool-start",
        tool: event.tool,
        summary: event.summary,
        permission: event.permission,
      };
    case "tool-end":
      return {
        kind: "tool-end",
        tool: event.tool,
        ok: event.ok,
        output: event.output,
        permission: event.permission,
        artifacts: event.artifacts,
      };
    case "tool-denied":
      return { kind: "denied", tool: event.tool, reason: event.reason };
    case "notice":
      return { kind: "notice", text: event.text };
    case "error":
      return { kind: "error", text: event.message };
    case "turn-end":
      return { kind: "cost", turn: event.turn, session: event.session };
  }
}

/**
 * Map a resumed session's replayed history to the same transcript shapes live
 * events produce — /resume shows the actual conversation, not a title line.
 * Tool items expand to the same start/end pair the live loop emits: the start
 * line carries the summary (for read-class tools it is the only visible line),
 * the end line carries outcome and output.
 */
export function replayItems(items: ReplayItem[]): TranscriptItem[] {
  return items.flatMap(replayed);
}

function replayed(item: ReplayItem): TranscriptItem[] {
  switch (item.kind) {
    case "user":
      return [{ kind: "user", text: item.text }];
    case "assistant":
      return [{ kind: "assistant", text: item.text, final: item.final }];
    case "tool":
      return [
        {
          kind: "tool-start",
          tool: item.tool,
          summary: item.summary,
          permission: item.permission,
        },
        {
          kind: "tool-end",
          tool: item.tool,
          ok: item.ok,
          output: item.output,
          permission: item.permission,
        },
      ];
    case "tool-denied":
      return [
        {
          kind: "tool-start",
          tool: item.tool,
          summary: item.summary,
          permission: item.permission,
        },
        { kind: "denied", tool: item.tool, reason: item.reason },
      ];
  }
}
