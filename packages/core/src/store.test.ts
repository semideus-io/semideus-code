import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
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

  test("sessions scope to a project, and report what's hidden", () => {
    const store = new SessionStore(":memory:");
    const base = {
      createdAt: 1,
      messages: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
    };
    store.upsertSession({
      ...base,
      id: "a",
      updatedAt: 3,
      cwd: "/repo/one",
      title: "one",
      model: "local",
      mode: "default",
    });
    store.upsertSession({
      ...base,
      id: "b",
      updatedAt: 2,
      cwd: "/repo/two",
      title: "two",
      model: "default",
      mode: "default",
    });

    expect(store.listSessions(20, "/repo/one").map((s) => s.id)).toEqual(["a"]);
    expect(store.listSessions().map((s) => s.id)).toEqual(["a", "b"]);
    expect(store.countSessionsElsewhere("/repo/one")).toBe(1);

    // `demi resume` with no id must not reach into another project's history,
    // even when that project's session is the most recent overall.
    expect(store.latestSessionId()).toBe("a");
    expect(store.latestSessionId("/repo/two")).toBe("b");
    expect(store.latestSessionId("/repo/none")).toBeNull();
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
    expect(decisions[0]?.artifact).toBeUndefined();
  });

  test("decision artifacts round-trip — the evidence /why renders", () => {
    const store = new SessionStore(":memory:");
    store.logDecision({
      ts: 1,
      sessionId: "s1",
      step: 1,
      kind: "edit",
      summary: "edit a.ts",
      rationale: "renamed for clarity",
      refs: ["a.ts"],
      artifact: { diff: "--- a\n+++ b\n-old\n+new" },
    });
    store.logDecision({
      ts: 2,
      sessionId: "s1",
      step: 2,
      kind: "tool_call",
      summary: "run tests",
      rationale: "verify the rename",
      refs: ["$ bun test"],
      artifact: { output: "7 pass\n0 fail" },
    });
    const [edit, run] = store.decisions("s1");
    expect(edit?.artifact?.diff).toContain("+new");
    expect(run?.artifact?.output).toBe("7 pass\n0 fail");
    expect(run?.artifact?.diff).toBeUndefined();
  });

  test("a pre-artifact database is migrated, and its old rows still read", () => {
    const path = `/tmp/demi-migrate-${process.pid}.sqlite`;
    // Stand up the schema as it shipped before artifacts existed.
    const legacy = new Database(path);
    legacy.exec(`
      create table decisions (
        id integer primary key autoincrement,
        session_id text not null,
        step integer not null,
        ts integer not null,
        kind text not null,
        summary text not null,
        rationale text not null,
        alternatives_json text,
        refs_json text not null default '[]'
      );
      insert into decisions (session_id, step, ts, kind, summary, rationale, refs_json)
      values ('s1', 1, 1, 'tool_call', 'old row', 'from before', '["a.ts"]');
    `);
    legacy.close();

    try {
      const store = new SessionStore(path);
      const [old] = store.decisions("s1");
      expect(old?.summary).toBe("old row");
      expect(old?.artifact).toBeUndefined();
      // And the widened table accepts new rows.
      store.logDecision({
        ts: 2,
        sessionId: "s1",
        step: 2,
        kind: "edit",
        summary: "new row",
        rationale: "",
        refs: [],
        artifact: { diff: "+x" },
      });
      expect(store.decisions("s1")[1]?.artifact?.diff).toBe("+x");
    } finally {
      rmSync(path, { force: true });
      rmSync(`${path}-wal`, { force: true });
      rmSync(`${path}-shm`, { force: true });
    }
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
