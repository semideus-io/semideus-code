import type { PermissionClass, Tool, ToolArtifacts } from "./contracts/tool";

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
  /** Pre-execution preview (diff, full command) when the tool can compute one. */
  preview?: ToolArtifacts;
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
 *
 * Base policy and in-session grants are kept apart so the live policy is
 * always inspectable and "always this session" is revocable (/permissions).
 */
export class PermissionGate {
  private readonly base: PermissionPolicy;
  private readonly sessionGrants = new Set<PermissionClass>();

  constructor(
    policy: PermissionPolicy,
    private readonly prompter?: ApprovalPrompter,
  ) {
    this.base = { ...policy };
  }

  /** The policy as it applies right now: base rules overlaid with session grants. */
  effective(): PermissionPolicy {
    const policy = { ...this.base };
    for (const granted of this.sessionGrants) policy[granted] = "allow";
    return policy;
  }

  /** Classes the user granted with "always this session". */
  sessionGranted(): PermissionClass[] {
    return [...this.sessionGrants];
  }

  /** Revoke all in-session grants — the base policy applies again. Returns what was revoked. */
  resetSessionGrants(): PermissionClass[] {
    const revoked = [...this.sessionGrants];
    this.sessionGrants.clear();
    return revoked;
  }

  async check(
    tool: Tool,
    input: unknown,
    summary: string,
    opts?: { preview?: () => Promise<ToolArtifacts | null> },
  ): Promise<Verdict> {
    const rule = this.effective()[tool.permission];
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
    // Computed lazily: only when a human is about to look at it. A crashing
    // preview degrades to the summary-only prompt — it must neither block the
    // ask nor slip past it.
    let preview: ToolArtifacts | undefined;
    try {
      preview = (await opts?.preview?.()) ?? undefined;
    } catch {
      preview = undefined;
    }
    const decision = await this.prompter({
      toolName: tool.name,
      permission: tool.permission,
      summary,
      input,
      preview,
    });
    if (decision === "allow-session") {
      this.sessionGrants.add(tool.permission);
      return { allowed: true };
    }
    if (decision === "allow") return { allowed: true };
    return { allowed: false, reason: "denied by user" };
  }
}
