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

export const writeFileTool: Tool<typeof schema> = {
  name: "write_file",
  description:
    "Create a new file or fully overwrite an existing one. Parent directories are created. For partial changes to an existing file, use edit_file instead.",
  schema,
  permission: "write",
  summarize: (input) => `write ${input.path} (${input.content.length} chars)`,
  async run(input, ctx) {
    const abs = resolvePath(ctx.cwd, input.path);
    const rel = displayPath(ctx.cwd, abs);
    if (!insideWorkspace(ctx.cwd, abs)) {
      return { ok: false, output: `refusing to write outside the workspace: ${rel}` };
    }

    const file = Bun.file(abs);
    const existed = await file.exists();
    const before = existed ? await file.text() : "";

    await ctx.snapshot(abs);
    mkdirSync(dirname(abs), { recursive: true });
    await Bun.write(abs, input.content);

    const diff = createTwoFilesPatch(rel, rel, before, input.content, "", "", { context: 3 });
    return {
      ok: true,
      output: `${existed ? "overwrote" : "created"} ${rel} (${input.content.length} chars)`,
      artifacts: { path: rel, diff },
    };
  },
};
