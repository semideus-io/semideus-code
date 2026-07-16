import type { Concept, SessionStore } from "@semideus/core";

/**
 * Phase 2 (the moat) builds on this: a `cheap`-model extraction pass over the
 * decision log + diffs feeds the ledger; SM-2 scheduling drives `demi review`;
 * the Semideus Learn MCP bridge turns digests into knowledge cards and gates
 * big merges on teach-back. See docs/PLAN.md §10.
 *
 * Everything here reads from DecisionEvents and artifacts — never from
 * unanchored model claims.
 */
export class ConceptLedger {
  constructor(private readonly store: SessionStore) {}

  record(concept: Concept): void {
    this.store.upsertConcept(concept);
  }

  all(): Concept[] {
    return this.store.concepts();
  }
}
