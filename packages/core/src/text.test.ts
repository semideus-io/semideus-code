import { describe, expect, test } from "bun:test";
import { extractRationale, firstLine, truncateMiddle } from "./text";

describe("extractRationale", () => {
  test("takes the last sentences of the last paragraph", () => {
    const text =
      "Some earlier paragraph.\n\nFirst sentence here. I'll read the config to check the defaults.";
    expect(extractRationale(text)).toContain("read the config");
  });

  test("empty text yields empty rationale", () => {
    expect(extractRationale("")).toBe("");
  });

  test("caps length", () => {
    expect(extractRationale(`${"word ".repeat(200)}.`).length).toBeLessThanOrEqual(280);
  });
});

describe("truncateMiddle", () => {
  test("keeps head and tail and reports dropped chars", () => {
    const out = truncateMiddle("a".repeat(50) + "b".repeat(50), 40);
    expect(out).toContain("truncated");
    expect(out.startsWith("a")).toBe(true);
    expect(out.endsWith("b")).toBe(true);
  });

  test("short text passes through", () => {
    expect(truncateMiddle("short", 100)).toBe("short");
  });
});

describe("firstLine", () => {
  test("returns the first non-empty line", () => {
    expect(firstLine("  hello\nworld")).toBe("hello");
  });
});
