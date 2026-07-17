import { describe, expect, test } from "bun:test";
import type { SessionMeta } from "@semideus/core";
import { formatSessionLine, resolvePick } from "./session-picker";

function meta(id: string, title: string): SessionMeta {
  return {
    id,
    createdAt: 1_752_700_000_000,
    updatedAt: 1_752_770_000_000,
    cwd: "/repo",
    title,
    model: "default",
    mode: "default",
  };
}

const sessions: SessionMeta[] = [
  meta("aaaa1111-0000-4000-8000-000000000001", "fix the gate"),
  meta("bbbb2222-0000-4000-8000-000000000002", "add repo map"),
  meta("bbbb3333-0000-4000-8000-000000000003", "readme audit"),
];

describe("resolvePick", () => {
  test("a 1-based index picks from the list as shown", () => {
    expect(resolvePick("1", sessions)).toBe(sessions[0]?.id ?? "");
    expect(resolvePick("3", sessions)).toBe(sessions[2]?.id ?? "");
  });

  test("out-of-range and non-integer numbers fall through to prefix matching", () => {
    expect(resolvePick("0", sessions)).toBeNull();
    expect(resolvePick("4", sessions)).toBeNull();
    expect(resolvePick("1.5", sessions)).toBeNull();
  });

  test("an id prefix resolves to the first matching session", () => {
    expect(resolvePick("aaaa", sessions)).toBe(sessions[0]?.id ?? "");
    // Ambiguous prefix: list order wins — the list is newest-first from the store.
    expect(resolvePick("bbbb", sessions)).toBe(sessions[1]?.id ?? "");
  });

  test("empty or whitespace input cancels, unknown prefixes resolve to nothing", () => {
    expect(resolvePick("", sessions)).toBeNull();
    expect(resolvePick("   ", sessions)).toBeNull();
    expect(resolvePick("zzzz", sessions)).toBeNull();
  });
});

describe("formatSessionLine", () => {
  test("shows short id, timestamp, model, and title", () => {
    const line = formatSessionLine(sessions[0] as SessionMeta);
    expect(line).toContain("aaaa1111");
    expect(line).toContain("[default]");
    expect(line).toContain("fix the gate");
    expect(line).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });
});
