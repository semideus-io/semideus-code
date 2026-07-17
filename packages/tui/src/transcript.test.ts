import { describe, expect, test } from "bun:test";
import type { ReplayItem, UsageTotals } from "@semideus/core";
import { replayItems, transcriptItem } from "./transcript";

const usage: UsageTotals = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.01,
};

describe("transcriptItem", () => {
  test("live parts render nothing: deltas and turn-start map to null", () => {
    expect(transcriptItem({ type: "assistant-delta", text: "chunk" })).toBeNull();
    expect(transcriptItem({ type: "turn-start", sessionId: "s" })).toBeNull();
  });

  test("finished events map 1:1 with their payloads intact", () => {
    expect(transcriptItem({ type: "assistant-text", text: "hi", final: true })).toEqual({
      kind: "assistant",
      text: "hi",
      final: true,
    });
    expect(
      transcriptItem({
        type: "tool-start",
        step: 1,
        tool: "bash",
        summary: "$ ls",
        permission: "execute",
      }),
    ).toEqual({ kind: "tool-start", tool: "bash", summary: "$ ls", permission: "execute" });
    expect(
      transcriptItem({
        type: "tool-end",
        step: 1,
        tool: "edit_file",
        ok: true,
        output: "edited",
        permission: "write",
        artifacts: { path: "a.ts", diff: "+x" },
      }),
    ).toEqual({
      kind: "tool-end",
      tool: "edit_file",
      ok: true,
      output: "edited",
      permission: "write",
      artifacts: { path: "a.ts", diff: "+x" },
    });
    expect(transcriptItem({ type: "tool-denied", step: 1, tool: "bash", reason: "no" })).toEqual({
      kind: "denied",
      tool: "bash",
      reason: "no",
    });
    expect(transcriptItem({ type: "notice", text: "n" })).toEqual({ kind: "notice", text: "n" });
    expect(transcriptItem({ type: "error", message: "e" })).toEqual({ kind: "error", text: "e" });
    expect(transcriptItem({ type: "turn-end", turn: usage, session: usage })).toEqual({
      kind: "cost",
      turn: usage,
      session: usage,
    });
  });
});

describe("replayItems", () => {
  test("user and assistant lines map 1:1", () => {
    const history: ReplayItem[] = [
      { kind: "user", text: "do it" },
      { kind: "assistant", text: "narrating", final: false },
      { kind: "assistant", text: "done", final: true },
    ];
    expect(replayItems(history)).toEqual([
      { kind: "user", text: "do it" },
      { kind: "assistant", text: "narrating", final: false },
      { kind: "assistant", text: "done", final: true },
    ]);
  });

  test("a tool expands to the live start/end pair — the start line carries the summary", () => {
    const history: ReplayItem[] = [
      {
        kind: "tool",
        tool: "read_file",
        summary: "read_file src/a.ts",
        ok: true,
        output: "…",
        permission: "read",
      },
    ];
    expect(replayItems(history)).toEqual([
      { kind: "tool-start", tool: "read_file", summary: "read_file src/a.ts", permission: "read" },
      { kind: "tool-end", tool: "read_file", ok: true, output: "…", permission: "read" },
    ]);
  });

  test("a denial expands to start + denied, so the refused intent stays visible", () => {
    const history: ReplayItem[] = [
      {
        kind: "tool-denied",
        tool: "bash",
        summary: "$ rm -rf build",
        permission: "execute",
        reason: "user said no",
      },
    ];
    expect(replayItems(history)).toEqual([
      { kind: "tool-start", tool: "bash", summary: "$ rm -rf build", permission: "execute" },
      { kind: "denied", tool: "bash", reason: "user said no" },
    ]);
  });

  test("empty history seeds an empty transcript", () => {
    expect(replayItems([])).toEqual([]);
  });
});
