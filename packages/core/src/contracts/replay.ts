import type { PermissionClass } from "./tool";

/**
 * A resumed session's stored messages, reconstructed into the same vocabulary
 * the transcript renders — so /resume shows what happened, not just a title
 * line. Distinct from AgentEvent: this is historical replay, not the live
 * stream, and needs a `user` case the live loop never emits itself (the app
 * synthesizes user lines locally on submit).
 *
 * Deliberately lossy: ToolArtifacts (diffs, full commands) aren't persisted
 * anywhere outside a live run, so replayed tool items carry text output only.
 */
export type ReplayItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; final: boolean }
  | {
      kind: "tool";
      tool: string;
      summary: string;
      ok: boolean;
      output: string;
      permission: PermissionClass;
    }
  | {
      kind: "tool-denied";
      tool: string;
      summary: string;
      permission: PermissionClass;
      reason: string;
    };
