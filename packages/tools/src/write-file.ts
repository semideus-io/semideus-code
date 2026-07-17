import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Tool } from "@semideus/core";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { displayPath, insideWorkspace, resolvePath } from "./shared";

const schema = z.object({
  path: z.string().describe("File path to create or overwrite, relative to the working directory"),
  content: z.string().describe("Full file content to write"),
});

type WriteInput = z.infer<typeof schema>;

type WritePlan =
  | { ok: true; abs: string; rel: string; existed: boolean; diff: string }
  | { ok: false; output: string };

/** Read-only plan shared by preview() and run(): same checks, same diff. */
async function planWrite(input: WriteInput, cwd: string): Promise<WritePlan> {
  const abs = resolvePath(cwd, input.path);
  const rel = displayPath(cwd, abs);
  if (!insideWorkspace(cwd, abs)) {
    return { ok: false, output: `refusing to write outside the workspace: ${rel}` };
  }

  const file = Bun.file(abs);
  const existed = await file.exists();
  const before = existed ? await file.text() : "";
  const diff = createTwoFilesPatch(rel, rel, before, input.content, "", "", { context: 3 });
  return { ok: true, abs, rel, existed, diff };
}

export const writeFileTool: Tool<typeof schema> = {
  name: "write_file",
  description:
    "Create a new file or fully overwrite an existing one. Parent directories are created. For partial changes to an existing file, use edit_file instead.",
  schema,
  permission: "write",
  summarize: (input) => `write ${input.path} (${input.content.length} chars)`,
  async preview(input, ctx) {
    try {
      const plan = await planWrite(input, ctx.cwd);
      return plan.ok ? { path: plan.rel, diff: plan.diff } : null;
    } catch {
      return null;
    }
  },
  async run(input, ctx) {
    const plan = await planWrite(input, ctx.cwd);
    if (!plan.ok) return plan;

    await ctx.snapshot(plan.abs);
    mkdirSync(dirname(plan.abs), { recursive: true });
    await Bun.write(plan.abs, input.content);

    return {
      ok: true,
      output: `${plan.existed ? "overwrote" : "created"} ${plan.rel} (${input.content.length} chars)`,
      artifacts: { path: plan.rel, diff: plan.diff },
    };
  },
};
