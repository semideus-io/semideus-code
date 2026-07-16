import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@semideus/core";
import { editFileTool } from "./edit-file";

let dir: string;
const dirs: string[] = [];

function setup(content: string): { ctx: ToolContext; file: string; snapshots: string[] } {
  dir = mkdtempSync(join(tmpdir(), "demi-edit-"));
  dirs.push(dir);
  const file = join(dir, "sample.ts");
  Bun.write(file, content);
  const snapshots: string[] = [];
  const ctx: ToolContext = {
    cwd: dir,
    sessionId: "test",
    step: 1,
    snapshot: async (p) => {
      snapshots.push(p);
    },
  };
  return { ctx, file, snapshots };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("edit_file", () => {
  test("replaces a unique match and returns a unified diff", async () => {
    const { ctx, file, snapshots } = setup("const a = 1;\nconst b = 2;\n");
    const res = await editFileTool.run(
      { path: "sample.ts", old_string: "const b = 2;", new_string: "const b = 3;" },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(await Bun.file(file).text()).toBe("const a = 1;\nconst b = 3;\n");
    expect(res.artifacts?.diff).toContain("-const b = 2;");
    expect(res.artifacts?.diff).toContain("+const b = 3;");
    expect(snapshots).toEqual([file]);
  });

  test("fails when old_string is ambiguous, without touching the file", async () => {
    const original = "let x = 0;\nlet x = 0;\n";
    const { ctx, file, snapshots } = setup(original);
    const res = await editFileTool.run(
      { path: "sample.ts", old_string: "let x = 0;", new_string: "let x = 1;" },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.output).toContain("2 locations");
    expect(await Bun.file(file).text()).toBe(original);
    expect(snapshots).toEqual([]);
  });

  test("replace_all replaces every occurrence", async () => {
    const { ctx, file } = setup("a\na\na\n");
    const res = await editFileTool.run(
      { path: "sample.ts", old_string: "a", new_string: "b", replace_all: true },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.output).toContain("3 replacements");
    expect(await Bun.file(file).text()).toBe("b\nb\nb\n");
  });

  test("fails when old_string is not found", async () => {
    const { ctx } = setup("hello\n");
    const res = await editFileTool.run(
      { path: "sample.ts", old_string: "goodbye", new_string: "x" },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.output).toContain("not found");
  });

  test("refuses to edit outside the workspace", async () => {
    const { ctx } = setup("x\n");
    const res = await editFileTool.run(
      { path: "/etc/hosts", old_string: "a", new_string: "b" },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.output).toContain("outside the workspace");
  });
});
