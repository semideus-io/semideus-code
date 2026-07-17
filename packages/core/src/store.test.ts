import { describe, expect, test } from "bun:test";
import { SessionStore } from "./store";

describe("SessionStore", () => {
  test("session round-trip preserves messages, usage and mode", () => {
    const store = new SessionStore(":memory:");
    store.upsertSession({
      id: "s1",
      createdAt: 1,
      updatedAt: 2,
      cwd: "/tmp/x",
      title: "hello",
      model: "default",
      mode: "explain",
      messages: [{ role: "user", content: "hi" }],
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.01,
      },
    });
    const loaded = store.loadSession("s1");
    expect(loaded?.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(loaded?.usage.inputTokens).toBe(10);
    expect(loaded?.mode).toBe("explain");
    expect(store.latestSessionId()).toBe("s1");
  });

  test("decisions come back in step order", () => {
    const store = new SessionStore(":memory:");
    store.logDecision({
      ts: 2,
      sessionId: "s1",
      step: 2,
      kind: "conclusion",
      summary: "done",
      rationale: "",
      refs: [],
    });
    store.logDecision({
      ts: 1,
      sessionId: "s1",
      step: 1,
      kind: "tool_call",
      summary: "read a file",
      rationale: "needed context",
      refs: ["a.ts"],
    });
    const decisions = store.decisions("s1");
    expect(decisions.map((d) => d.step)).toEqual([1, 2]);
    expect(decisions[0]?.refs).toEqual(["a.ts"]);
  });

  test("snapshots group by step and can be deleted per step", () => {
    const store = new SessionStore(":memory:");
    store.saveSnapshot("s1", 1, "/tmp/a", true, "old");
    store.saveSnapshot("s1", 3, "/tmp/b", false, null);
    expect(store.latestSnapshotStep("s1")).toBe(3);
    const rows = store.snapshotsForStep("s1", 3);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.existed).toBe(false);
    store.deleteSnapshotsForStep("s1", 3);
    expect(store.latestSnapshotStep("s1")).toBe(1);
  });
});
