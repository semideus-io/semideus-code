import type { Tool } from "@semideus/core";
import fg from "fast-glob";
import { z } from "zod";
import { resolvePath } from "./shared";

const MAX_RESULTS = 500;

const schema = z.object({
  pattern: z.string().describe('Glob pattern, e.g. "src/**/*.ts" or "**/package.json"'),
  cwd: z
    .string()
    .optional()
    .describe("Directory to search from; defaults to the working directory"),
});

export const globTool: Tool<typeof schema> = {
  name: "glob",
  description:
    "Find files by glob pattern. Returns matching paths sorted alphabetically. node_modules and .git are always excluded.",
  schema,
  permission: "read",
  summarize: (input) => `glob ${input.pattern}${input.cwd ? ` in ${input.cwd}` : ""}`,
  async run(input, ctx) {
    const base = input.cwd ? resolvePath(ctx.cwd, input.cwd) : ctx.cwd;
    const matches = await fg(input.pattern, {
      cwd: base,
      dot: false,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/.git/**"],
    });
    matches.sort();
    if (matches.length === 0) return { ok: true, output: "(no matches)" };
    const shown = matches.slice(0, MAX_RESULTS);
    const note =
      matches.length > MAX_RESULTS
        ? `\n…[${matches.length - MAX_RESULTS} more matches hidden — narrow the pattern]`
        : "";
    return { ok: true, output: shown.join("\n") + note };
  },
};
