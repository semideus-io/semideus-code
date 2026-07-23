import type { z } from "zod";

export type PermissionClass = "read" | "write" | "execute" | "network";

export interface ToolArtifacts {
  path?: string;
  diff?: string;
  command?: string;
}

export interface ToolResult {
  ok: boolean;
  /** What the model sees. Failures must be actionable, e.g. "old_string matched 3 locations". */
  output: string;
  artifacts?: ToolArtifacts;
}

export interface ToolContext {
  cwd: string;
  sessionId: string;
  step: number;
  /** Mutating tools MUST call this before touching the file. Backs /undo. */
  snapshot(absPath: string): Promise<void>;
  /**
   * Fires when the user interrupts the turn. Long-running tools (bash) should
   * stop work and return an ok:false result promptly; fast tools may ignore it.
   */
  signal?: AbortSignal;
}

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  /** Written for the model, not for humans. */
  description: string;
  schema: S;
  permission: PermissionClass;
  /** One-line "what is about to happen" — shown in approval prompts and logged to the decision log. */
  summarize(input: z.infer<S>): string;
  /**
   * What would happen, computed WITHOUT doing it — rendered in the approval
   * prompt so the user approves the change itself, not a stated intent.
   * Must be read-only (no writes, no snapshots) and never throw; return null
   * when nothing useful can be computed (run() will surface the failure).
   * run() recomputes from current disk state, so an executed change is honest
   * even if the file moved between preview and approval.
   */
  preview?(input: z.infer<S>, ctx: ToolContext): Promise<ToolArtifacts | null>;
  /** Never throws: failures are `ok: false` with a message the model can act on. */
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}
