import type { Tool } from "@semideus/core";
import { truncateMiddle } from "@semideus/core";
import { z } from "zod";

const MAX_STREAM = 20_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

const schema = z.object({
  command: z.string().describe("Shell command to run with bash -c in the working directory"),
  timeout_ms: z
    .number()
    .int()
    .min(1_000)
    .max(MAX_TIMEOUT_MS)
    .optional()
    .describe(`Timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS})`),
  description: z
    .string()
    .optional()
    .describe("One short clause describing what this command does, shown to the user"),
});

export const bashTool: Tool<typeof schema> = {
  name: "bash",
  description:
    "Run a shell command in the working directory. Returns exit code, stdout and stderr. Prefer the dedicated read/glob/grep tools over cat/find/grep. State-changing commands need user approval.",
  schema,
  permission: "execute",
  summarize: (input) => input.description ?? `$ ${input.command.split("\n")[0]?.slice(0, 100)}`,
  // The summary truncates (and may be the model's own description of the
  // command) — approval must show the full command that will actually run.
  async preview(input) {
    return { command: input.command };
  },
  async run(input, ctx) {
    const timeout = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const proc = Bun.spawn(["bash", "-c", input.command], {
      cwd: ctx.cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: process.env,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);

    const sections = [`exit code: ${code}${timedOut ? ` (killed after ${timeout}ms)` : ""}`];
    if (stdout.trim())
      sections.push(`── stdout ──\n${truncateMiddle(stdout.trimEnd(), MAX_STREAM)}`);
    if (stderr.trim())
      sections.push(`── stderr ──\n${truncateMiddle(stderr.trimEnd(), MAX_STREAM)}`);

    return {
      ok: code === 0 && !timedOut,
      output: sections.join("\n"),
      artifacts: { command: input.command },
    };
  },
};
