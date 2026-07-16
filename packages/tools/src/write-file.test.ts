import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@semideus/core";
import { writeFileTool } from "./write-file";

const dirs: string[] = [];

function ctx(): ToolContext {
  const dir = mkdtempSync(join(tmpdir(), "demi-write-"));
  dirs.push(dir);
  return { cwd: dir, sessionId: "test", step: 1, snapshot: async () => {} };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("write_file", () => {
  test("creates a file in a nested directory", async () => {
    const context = ctx();
    const res = await writeFileTool.run({ path: "deep/nested/new.txt", content: "hi\n" }, context);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("created");
    expect(await Bun.file(join(context.cwd, "deep/nested/new.txt")).text()).toBe("hi\n");
  });

  test("overwrite reports a diff against the previous content", async () => {
    const context = ctx();
    await writeFileTool.run({ path: "a.txt", content: "one\n" }, context);
    const res = await writeFileTool.run({ path: "a.txt", content: "two\n" }, context);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("overwrote");
    expect(res.artifacts?.diff).toContain("-one");
    expect(res.artifacts?.diff).toContain("+two");
  });

  test("refuses paths outside the workspace", async () => {
    const res = await writeFileTool.run({ path: "../escape.txt", content: "x" }, ctx());
    expect(res.ok).toBe(false);
    expect(res.output).toContain("outside the workspace");
  });
});
