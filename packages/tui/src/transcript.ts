import type {
  AgentEvent,
  ApprovalDecision,
  PermissionClass,
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
