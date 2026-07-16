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
}

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  /** Written for the model, not for humans. */
  description: string;
  schema: S;
  permission: PermissionClass;
  /** One-line "what is about to happen" — shown in approval prompts and logged to the decision log. */
  summarize(input: z.infer<S>): string;
  /** Never throws: failures are `ok: false` with a message the model can act on. */
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}
