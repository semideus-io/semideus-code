import type { ApprovalDecision, ApprovalRequest } from "@semideus/core";

export interface PendingApproval {
  request: ApprovalRequest;
  resolve(decision: ApprovalDecision): void;
}

/**
 * Connects the permission gate's prompter to the approval overlay: the gate
 * awaits `prompter(request)` while the app renders the pending request and
 * resolves it with the user's keypress. Pure UI plumbing — the decision still
 * flows through PermissionGate.check like every other approval.
 */
export class ApprovalBridge {
  private listener: (pending: PendingApproval | null) => void = () => {};
  private pending: PendingApproval | null = null;

  /** The gate's ApprovalPrompter. The loop is sequential — one request at a time. */
  readonly prompter = (request: ApprovalRequest): Promise<ApprovalDecision> => {
    if (this.pending) {
      return Promise.reject(new Error("an approval is already pending"));
    }
    return new Promise((resolve) => {
      this.pending = {
        request,
        resolve: (decision) => {
          this.pending = null;
          this.listener(null);
          resolve(decision);
        },
      };
      this.listener(this.pending);
    });
  };

  /** Single subscriber (the app). Immediately replays a request already in flight. */
  subscribe(listener: (pending: PendingApproval | null) => void): () => void {
    this.listener = listener;
    if (this.pending) listener(this.pending);
    return () => {
      this.listener = () => {};
    };
  }
}
