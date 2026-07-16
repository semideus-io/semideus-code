/**
 * A concept the user encountered while coding — extracted (phase 2) from diffs
 * and the decision log by the `cheap` model, stored in the ledger, scheduled
 * for recall, and optionally deposited into Semideus Learn via MCP.
 */
export interface Concept {
  slug: string;
  name: string;
  kind: "api" | "pattern" | "pitfall" | "domain";
  /** Grounded in the user's own code from the session that surfaced it. */
  example: string;
  firstSeen: number;
  occurrences: number;
}
