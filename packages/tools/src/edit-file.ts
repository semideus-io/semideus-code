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

type EditInput = z.infer<typeof schema>;

type EditPlan =
  | { ok: true; abs: string; rel: string; after: string; count: number; diff: string }
  | { ok: false; output: string };

/**
 * Everything up to (but excluding) the mutation, computed from current disk
 * state. preview() and run() both go through here, so the diff a user
 * approves is computed by the same code as the diff that gets applied.
 */
async function planEdit(input: EditInput, cwd: string): Promise<EditPlan> {
  const abs = resolvePath(cwd, input.path);
  const rel = displayPath(cwd, abs);
  if (!insideWorkspace(cwd, abs)) {
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
  const diff = createTwoFilesPatch(rel, rel, before, after, "", "", { context: 3 });
  return { ok: true, abs, rel, after, count, diff };
}

export const editFileTool: Tool<typeof schema> = {
  name: "edit_file",
  description:
    "Edit a file by exact string replacement. old_string must match the current file content exactly and uniquely (or set replace_all). Returns a unified diff of the change. Read the file first.",
  schema,
  permission: "write",
  summarize: (input) => `edit ${input.path}${input.replace_all ? " (replace all)" : ""}`,
  async preview(input, ctx) {
    try {
      const plan = await planEdit(input, ctx.cwd);
      return plan.ok ? { path: plan.rel, diff: plan.diff } : null;
    } catch {
      return null;
    }
  },
  async run(input, ctx) {
    const plan = await planEdit(input, ctx.cwd);
    if (!plan.ok) return plan;

    await ctx.snapshot(plan.abs);
    await Bun.write(plan.abs, plan.after);

    const replacements = input.replace_all ? plan.count : 1;
    return {
      ok: true,
      output: `edited ${plan.rel} (${replacements} replacement${replacements === 1 ? "" : "s"})\n${truncateMiddle(plan.diff, MAX_DIFF_IN_OUTPUT)}`,
      artifacts: { path: plan.rel, diff: plan.diff },
    };
  },
};
