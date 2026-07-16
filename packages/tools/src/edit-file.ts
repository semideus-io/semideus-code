import type { Tool } from "@semideus/core";
import { truncateMiddle } from "@semideus/core";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { countOccurrences, displayPath, insideWorkspace, resolvePath } from "./shared";

const MAX_DIFF_IN_OUTPUT = 6_000;

const schema = z.object({
  path: z.string().describe("File to edit, relative to the working directory"),
  old_string: z
    .string()
    .describe(
      "Exact text to replace. Must match the file byte-for-byte (whitespace and indentation included) and be unique in the file — include surrounding lines to disambiguate.",
    ),
  new_string: z.string().describe("Replacement text"),
  replace_all: z
    .boolean()
    .optional()
    .describe("Replace every occurrence instead of requiring a unique match"),
});

export const editFileTool: Tool<typeof schema> = {
  name: "edit_file",
  description:
    "Edit a file by exact string replacement. old_string must match the current file content exactly and uniquely (or set replace_all). Returns a unified diff of the change. Read the file first.",
  schema,
  permission: "write",
  summarize: (input) => `edit ${input.path}${input.replace_all ? " (replace all)" : ""}`,
  async run(input, ctx) {
    const abs = resolvePath(ctx.cwd, input.path);
    const rel = displayPath(ctx.cwd, abs);
    if (!insideWorkspace(ctx.cwd, abs)) {
      return { ok: false, output: `refusing to edit outside the workspace: ${rel}` };
    }
    if (input.old_string === input.new_string) {
      return { ok: false, output: "old_string and new_string are identical — nothing to do" };
    }

    const file = Bun.file(abs);
    if (!(await file.exists())) {
      return { ok: false, output: `no such file: ${rel} — use write_file to create it` };
    }
    const before = await file.text();

    const count = countOccurrences(before, input.old_string);
    if (count === 0) {
      return {
        ok: false,
        output: `old_string not found in ${rel} — read the file and match the current content exactly (whitespace matters)`,
      };
    }
    if (count > 1 && !input.replace_all) {
      return {
        ok: false,
        output: `old_string matches ${count} locations in ${rel} — add surrounding context to make it unique, or set replace_all`,
      };
    }

    const after = input.replace_all
      ? before.split(input.old_string).join(input.new_string)
      : before.replace(input.old_string, () => input.new_string);

    await ctx.snapshot(abs);
    await Bun.write(abs, after);

    const diff = createTwoFilesPatch(rel, rel, before, after, "", "", { context: 3 });
    const replacements = input.replace_all ? count : 1;
    return {
      ok: true,
      output: `edited ${rel} (${replacements} replacement${replacements === 1 ? "" : "s"})\n${truncateMiddle(diff, MAX_DIFF_IN_OUTPUT)}`,
      artifacts: { path: rel, diff },
    };
  },
};
