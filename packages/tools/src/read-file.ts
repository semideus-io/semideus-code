import type { Tool } from "@semideus/core";
import { z } from "zod";
import { displayPath, resolvePath } from "./shared";

const MAX_CHARS = 100_000;

const schema = z.object({
  path: z.string().describe("File path, absolute or relative to the working directory"),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based line number to start reading from (for large files)"),
  limit: z.number().int().min(1).optional().describe("Maximum number of lines to return"),
});

export const readFileTool: Tool<typeof schema> = {
  name: "read_file",
  description:
    "Read a text file. Returns the exact file content (no line numbers added), optionally windowed by offset/limit. Always read a file before editing it.",
  schema,
  permission: "read",
  summarize: (input) => `read ${input.path}${input.offset ? ` from line ${input.offset}` : ""}`,
  async run(input, ctx) {
    const abs = resolvePath(ctx.cwd, input.path);
    const rel = displayPath(ctx.cwd, abs);
    const file = Bun.file(abs);
    if (!(await file.exists())) return { ok: false, output: `no such file: ${rel}` };

    const text = await file.text();
    if (text.includes("\u0000")) {
      return { ok: false, output: `${rel} looks binary (${file.size} bytes) — not shown` };
    }

    let lines = text.split("\n");
    const total = lines.length;
    if (input.offset) lines = lines.slice(input.offset - 1);
    if (input.limit) lines = lines.slice(0, input.limit);
    let body = lines.join("\n");

    let note = "";
    if (body.length > MAX_CHARS) {
      body = body.slice(0, MAX_CHARS);
      note = `\n…[truncated at ${MAX_CHARS} chars — use offset/limit to read the rest of the ${total} lines]`;
    } else if (input.offset || input.limit) {
      const from = input.offset ?? 1;
      note = `\n[showing lines ${from}–${from + lines.length - 1} of ${total}]`;
    }

    return { ok: true, output: body + note, artifacts: { path: rel } };
  },
};
