import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRepoMap } from "./build";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repomap-"));
  writeFileSync(join(dir, "core.ts"), "export function runTurn(): void {}\n");
  writeFileSync(join(dir, "app.ts"), "import { runTurn } from './core';\nrunTurn();\n");
  mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "dep", "index.ts"), "export const hidden = 1;\n");
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist", "bundle.js"), "var x = 1;\n");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildRepoMap", () => {
  test("cold build parses everything, renders the map, and writes the cache", async () => {
    const result = await buildRepoMap(dir);
    expect(result.files).toBe(2); // node_modules and dist never counted
    expect(result.parsed).toBe(2);
    expect(result.map).toContain("core.ts:");
    expect(result.map).toContain("export function runTurn(): void");
    expect(result.map).not.toContain("hidden");
    expect(await Bun.file(join(dir, ".demi", "cache", "repomap.json")).exists()).toBe(true);
  });

  test("warm build re-parses nothing and renders the same map", async () => {
    const cold = await buildRepoMap(dir);
    const warm = await buildRepoMap(dir);
    expect(warm.parsed).toBe(0);
    expect(warm.map).toBe(cold.map);
  });

  test("touching one file re-parses only that file", async () => {
    await buildRepoMap(dir);
    // Content change bumps mtime; the other file stays cached.
    writeFileSync(join(dir, "core.ts"), "export function runTurn(x: number): void {}\n");
    const rebuilt = await buildRepoMap(dir);
    expect(rebuilt.parsed).toBe(1);
    expect(rebuilt.map).toContain("runTurn(x: number)");
  });

  test("a corrupt cache file rebuilds from scratch instead of throwing", async () => {
    await buildRepoMap(dir);
    writeFileSync(join(dir, ".demi", "cache", "repomap.json"), "{not json at all");
    const rebuilt = await buildRepoMap(dir);
    expect(rebuilt.parsed).toBe(2);
    expect(rebuilt.map).toContain("core.ts:");
  });

  test("an empty workspace yields an empty map, not an error", async () => {
    const empty = mkdtempSync(join(tmpdir(), "repomap-empty-"));
    try {
      const result = await buildRepoMap(empty);
      expect(result).toMatchObject({ map: "", files: 0, parsed: 0 });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("the budget option flows through to the renderer", async () => {
    const result = await buildRepoMap(dir, { budgetTokens: 1 }); // 4 chars — nothing fits
    expect(result.map).toBe("");
  });
});
