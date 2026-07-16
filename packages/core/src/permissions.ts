import type { PermissionClass, Tool } from "./contracts/tool";

export type PolicyRule = "allow" | "ask" | "deny";

export type PermissionPolicy = Record<PermissionClass, PolicyRule>;

export const DEFAULT_POLICY: PermissionPolicy = {
  read: "allow",
  write: "ask",
  execute: "ask",
  network: "ask",
};

export interface ApprovalRequest {
  toolName: string;
  permission: PermissionClass;
  summary: string;
  input: unknown;
}

export type ApprovalDecision = "allow" | "allow-session" | "deny";

export type ApprovalPrompter = (req: ApprovalRequest) => Promise<ApprovalDecision>;

export interface Verdict {
  allowed: boolean;
  reason?: string;
}

/**
 * The non-bypassable gate between the model's intent and the world.
 * Auto-accept is a policy setting that flows THROUGH here ("allow" rules,
 * or a user answering "allow-session") — never a code path around it.
 */
export class PermissionGate {
  constructor(
    private readonly policy: PermissionPolicy,
    private readonly prompter?: ApprovalPrompter,
  ) {}

  async check(tool: Tool, input: unknown, summary: string): Promise<Verdict> {
    const rule = this.policy[tool.permission];
    if (rule === "allow") return { allowed: true };
    if (rule === "deny") {
      return { allowed: false, reason: `policy denies "${tool.permission}" actions` };
    }
    if (!this.prompter) {
      return {
        allowed: false,
        reason: `"${tool.permission}" needs approval but no approver is attached — run interactively or pass --yes`,
      };
    }
    const decision = await this.prompter({
      toolName: tool.name,
      permission: tool.permission,
      summary,
      input,
    });
    if (decision === "allow-session") {
      this.policy[tool.permission] = "allow";
      return { allowed: true };
    }
    if (decision === "allow") return { allowed: true };
    return { allowed: false, reason: "denied by user" };
  }
}
