import { describe, expect, test } from "bun:test";
import type { FileExtract } from "./extract";
import { rankFiles } from "./rank";

function file(defs: Array<[string, boolean]>, idents: Record<string, number>): FileExtract {
  return {
    defs: defs.map(([name, exported], i) => ({
      name,
      exported,
      kind: "function" as const,
      signature: `function ${name}()`,
      line: i + 1,
    })),
    idents,
  };
}

/** core is used by both app and util; util is used by app only. */
const TOY: Record<string, FileExtract> = {
  "core.ts": file([["runTurn", true]], { runTurn: 1 }),
  "util.ts": file([["helper", true]], { runTurn: 2, helper: 1 }),
  "app.ts": file([], { runTurn: 3, helper: 2 }),
};

describe("rankFiles", () => {
  test("the file everyone references ranks first", () => {
    const ranked = rankFiles(TOY);
    expect(ranked[0]?.path).toBe("core.ts");
    expect(ranked.map((r) => r.path)).toEqual(["core.ts", "util.ts", "app.ts"]);
  });

  test("scores form a probability distribution — no NaN, sums to 1", () => {
    const ranked = rankFiles(TOY);
    for (const r of ranked) expect(Number.isFinite(r.score)).toBe(true);
    const sum = ranked.reduce((s, r) => s + r.score, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  test("personalization shifts the ranking toward the highlighted file's deps", () => {
    const extracts: Record<string, FileExtract> = {
      "a.ts": file([["fromA", true]], {}),
      "b.ts": file([["fromB", true]], {}),
      "usesA.ts": file([], { fromA: 5 }),
      "usesB.ts": file([], { fromB: 5 }),
    };
    const towardA = rankFiles(extracts, { personalization: { "usesA.ts": 1 } });
    const towardB = rankFiles(extracts, { personalization: { "usesB.ts": 1 } });
    const score = (ranked: ReturnType<typeof rankFiles>, path: string) =>
      ranked.find((r) => r.path === path)?.score ?? 0;
    expect(score(towardA, "a.ts")).toBeGreaterThan(score(towardA, "b.ts"));
    expect(score(towardB, "b.ts")).toBeGreaterThan(score(towardB, "a.ts"));
  });

  test("unknown personalization paths are ignored, falling back to uniform", () => {
    const uniform = rankFiles(TOY);
    const bogus = rankFiles(TOY, { personalization: { "nope.ts": 9 } });
    expect(bogus).toEqual(uniform);
  });

  test("dangling files (no outgoing references) neither vanish nor NaN", () => {
    const extracts: Record<string, FileExtract> = {
      "hub.ts": file([["x", true]], {}),
      "leaf.ts": file([], { x: 1 }),
      "island.ts": file([], {}),
    };
    const ranked = rankFiles(extracts);
    const island = ranked.find((r) => r.path === "island.ts");
    expect(island).toBeDefined();
    expect(Number.isFinite(island?.score ?? Number.NaN)).toBe(true);
    expect((island?.score ?? 0) > 0).toBe(true);
  });

  test("a name exported by two files splits its weight between them", () => {
    const extracts: Record<string, FileExtract> = {
      "one.ts": file([["shared", true]], {}),
      "two.ts": file([["shared", true]], {}),
      "user.ts": file([], { shared: 4 }),
    };
    const ranked = rankFiles(extracts);
    const one = ranked.find((r) => r.path === "one.ts")?.score ?? 0;
    const two = ranked.find((r) => r.path === "two.ts")?.score ?? 0;
    expect(one).toBeCloseTo(two, 10);
    expect(one).toBeGreaterThan(ranked.find((r) => r.path === "user.ts")?.score ?? 1);
  });

  test("non-exported defs draw no references", () => {
    const extracts: Record<string, FileExtract> = {
      "private.ts": file([["hidden", false]], {}),
      "public.ts": file([["shown", true]], {}),
      "user.ts": file([], { hidden: 9, shown: 1 }),
    };
    const ranked = rankFiles(extracts);
    const privateScore = ranked.find((r) => r.path === "private.ts")?.score ?? 0;
    const publicScore = ranked.find((r) => r.path === "public.ts")?.score ?? 0;
    expect(publicScore).toBeGreaterThan(privateScore);
  });

  test("empty input ranks to an empty list", () => {
    expect(rankFiles({})).toEqual([]);
  });
});
