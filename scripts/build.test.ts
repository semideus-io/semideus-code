import { describe, expect, test } from "bun:test";
import cliPkg from "../packages/cli/package.json" with { type: "json" };
import { checksumLine, sha256, TARGETS, VERSION } from "./build";

describe("build script", () => {
  test("covers exactly the four ADR-0010 targets, windows with .exe", () => {
    expect(TARGETS.map((t) => t.target)).toEqual([
      "bun-linux-x64",
      "bun-darwin-arm64",
      "bun-darwin-x64",
      "bun-windows-x64",
    ]);
    for (const { target, artifact } of TARGETS) {
      const suffix = target === "bun-windows-x64" ? ".exe" : "";
      expect(String(artifact)).toBe(`daimon-${target.replace("bun-", "")}${suffix}`);
    }
  });

  test("version comes from the cli package — the single source of truth", () => {
    expect(VERSION).toBe(cliPkg.version);
  });

  test("checksum lines are shasum -c compatible (two-space separator)", () => {
    expect(checksumLine("abc123", "daimon-linux-x64")).toBe("abc123  daimon-linux-x64");
  });

  test("sha256 hashes file contents, hex-encoded", async () => {
    const path = `${import.meta.dir}/../LICENSE`;
    const hex = await sha256(path);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).toBe(await sha256(path)); // deterministic
  });
});
