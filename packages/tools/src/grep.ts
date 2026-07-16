import type { Tool } from "@semideus/core";
import { truncateMiddle } from "@semideus/core";
import { z } from "zod";
import { resolvePath } from "./shared";

const MAX_OUTPUT = 20_000;

const schema = z.object({
  pattern: z.string().describe("Regular expression to search for (ripgrep syntax)"),
  path: z
    .string()
    .optional()
    .describe("File or directory to search; defaults to the working directory"),
  glob: z.string().optional().describe('Restrict to files matching this glob, e.g. "*.ts"'),
});

export const grepTool: Tool<typeof schema> = {
  name: "grep",
  description:
    "Search file contents with ripgrep. Returns matching lines as path:line:text. Case-insensitive unless the pattern contains an uppercase letter.",
  schema,
  permission: "read",
  summarize: (input) => `grep /${input.pattern}/${input.path ? ` in ${input.path}` : ""}`,
  async run(input, ctx) {
    const args = ["--no-heading", "--line-number", "--color", "never", "--smart-case"];
    if (input.glob) args.push("--glob", input.glob);
    args.push("--", input.pattern, input.path ? resolvePath(ctx.cwd, input.path) : ".");

    if (Bun.which("rg") === null) {
      return {
        ok: false,
        output: "ripgrep (rg) is not installed or not on PATH — install it (brew install ripgrep)",
      };
    }
    const proc = Bun.spawn(["rg", ...args], { cwd: ctx.cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (code === 0) return { ok: true, output: truncateMiddle(stdout.trimEnd(), MAX_OUTPUT) };
    if (code === 1) return { ok: true, output: "(no matches)" };
    return { ok: false, output: `rg failed (exit ${code}): ${stderr.trim()}` };
  },
};
