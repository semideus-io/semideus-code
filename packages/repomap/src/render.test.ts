import { describe, expect, test } from "bun:test";
import type { DefSymbol, FileExtract } from "./extract";
import { renderMap } from "./render";

function def(name: string, line: number, exported = true): DefSymbol {
  return { name, kind: "function", signature: `export function ${name}()`, line, exported };
}

function extractOf(...defs: DefSymbol[]): FileExtract {
  return { defs, idents: {} };
}

const RANKED = [
  { path: "core.ts", score: 0.5 },
  { path: "util.ts", score: 0.3 },
  { path: "app.ts", score: 0.2 },
];

describe("renderMap", () => {
  test("renders ranked sections with indented signature lines", () => {
    const out = renderMap(RANKED, {
      "core.ts": extractOf(def("runTurn", 1)),
      "util.ts": extractOf(def("helper", 3)),
      "app.ts": extractOf(def("main", 9)),
    });
    expect(out).toBe(
      [
        "core.ts:",
        "  export function runTurn()",
        "util.ts:",
        "  export function helper()",
        "app.ts:",
        "  export function main()",
      ].join("\n"),
    );
  });

  test("stops at the first section that would overflow — never cuts mid-file", () => {
    const big = extractOf(...Array.from({ length: 8 }, (_, i) => def(`veryLongName${i}`, i + 1)));
    const out = renderMap(
      RANKED,
      {
        "core.ts": extractOf(def("fits", 1)),
        "util.ts": big,
        "app.ts": extractOf(def("neverReached", 1)),
      },
      { budgetTokens: 20 },
    ); // 80 chars: core fits, util would overflow
    expect(out).toContain("core.ts:");
    expect(out).not.toContain("util.ts:");
    expect(out).not.toContain("neverReached");
  });

  test("respects the chars/4 budget for what it does emit", () => {
    const extracts: Record<string, FileExtract> = {};
    for (const { path } of RANKED) extracts[path] = extractOf(def("x", 1));
    const out = renderMap(RANKED, extracts, { budgetTokens: 25 });
    expect(out.length).toBeLessThanOrEqual(25 * 4);
    expect(out.length).toBeGreaterThan(0);
  });

  test("skips def-less files instead of spending budget on them", () => {
    const out = renderMap(RANKED, {
      "core.ts": extractOf(),
      "util.ts": extractOf(def("helper", 1)),
      "app.ts": extractOf(def("main", 1)),
    });
    expect(out).not.toContain("core.ts");
    expect(out.startsWith("util.ts:")).toBe(true);
  });

  test("exported defs win the per-file slots; a counter reports the rest", () => {
    const defs: DefSymbol[] = [
      def("aPrivate", 1, false),
      def("bPublic", 2, true),
      def("cPrivate", 3, false),
      def("dPublic", 4, true),
    ];
    const out = renderMap(
      [{ path: "f.ts", score: 1 }],
      { "f.ts": extractOf(...defs) },
      {
        maxDefsPerFile: 2,
      },
    );
    expect(out).toContain("bPublic");
    expect(out).toContain("dPublic");
    expect(out).not.toContain("aPrivate");
    expect(out).toContain("… 2 more");
  });

  test("overlong signatures truncate with an ellipsis", () => {
    const long: DefSymbol = {
      name: "x",
      kind: "function",
      signature: `export function x(${"a: number, ".repeat(30)})`,
      line: 1,
      exported: true,
    };
    const out = renderMap([{ path: "f.ts", score: 1 }], { "f.ts": extractOf(long) });
    const line = out.split("\n")[1] ?? "";
    expect(line.endsWith("…")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(122);
  });

  test("empty ranking renders an empty map", () => {
    expect(renderMap([], {})).toBe("");
  });
});
