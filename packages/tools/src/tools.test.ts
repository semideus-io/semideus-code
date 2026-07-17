import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@semideus/core";
import { bashTool } from "./bash";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { readFileTool } from "./read-file";

const dir = mkdtempSync(join(tmpdir(), "demi-tools-"));
const ctx: ToolContext = { cwd: dir, sessionId: "test", step: 1, snapshot: async () => {} };

await Bun.write(join(dir, "src/alpha.ts"), "export const alpha = 1;\n");
await Bun.write(join(dir, "src/beta.ts"), "export const beta = 2;\n");
await Bun.write(join(dir, "notes.md"), "l1\nl2\nl3\nl4\n");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("read_file", () => {
  test("reads content verbatim", async () => {
    const res = await readFileTool.run({ path: "src/alpha.ts" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("export const alpha = 1;");
  });

  test("offset/limit windows the file and reports the range", async () => {
    const res = await readFileTool.run({ path: "notes.md", offset: 2, limit: 2 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("l2\nl3");
    expect(res.output).not.toContain("l1");
    expect(res.output).toContain("lines 2–3");
  });

  test("missing file is a clean failure", async () => {
    const res = await readFileTool.run({ path: "nope.txt" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("no such file");
  });
});

describe("glob", () => {
  test("finds files and excludes node_modules", async () => {
    await Bun.write(join(dir, "node_modules/pkg/index.ts"), "x");
    const res = await globTool.run({ pattern: "**/*.ts" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("src/alpha.ts");
    expect(res.output).toContain("src/beta.ts");
    expect(res.output).not.toContain("node_modules");
  });

  test("no matches is ok, not an error", async () => {
    const res = await globTool.run({ pattern: "**/*.rs" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toBe("(no matches)");
  });
});

const rgAvailable = Bun.which("rg") !== null;

describe("grep", () => {
  test.skipIf(!rgAvailable)("finds matching lines with path:line", async () => {
    const res = await grepTool.run({ pattern: "const beta" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("beta.ts");
    expect(res.output).toContain("2;");
  });

  test.skipIf(!rgAvailable)("no matches is ok", async () => {
    const res = await grepTool.run({ pattern: "zzz_never_here" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toBe("(no matches)");
  });
});

describe("bash", () => {
  test("captures stdout and exit code 0", async () => {
    const res = await bashTool.run({ command: "echo hello" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("exit code: 0");
    expect(res.output).toContain("hello");
  });

  test("preview carries the full command, not the truncated summary", async () => {
    const command = `echo ${"x".repeat(120)}\necho second line`;
    const preview = await bashTool.preview?.({ command }, ctx);
    expect(preview?.command).toBe(command);
  });

  test("non-zero exit is not ok and stderr is shown", async () => {
    const res = await bashTool.run({ command: "echo oops >&2; exit 3" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("exit code: 3");
    expect(res.output).toContain("oops");
  });

  test("timeout kills the process", async () => {
    const res = await bashTool.run({ command: "sleep 5", timeout_ms: 1_000 }, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("killed after");
  }, 10_000);

  test("runs in the workspace cwd", async () => {
    const res = await bashTool.run({ command: "pwd" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain(dir.split("/").at(-1) as string);
  });
});
