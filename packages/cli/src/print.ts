import type { AgentEvent, UsageTotals } from "@semideus/core";
import { firstLine } from "@semideus/core";
import { c } from "./colors";

const MAX_DIFF_LINES = 80;
const MAX_OUTPUT_TAIL_LINES = 10;

export function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case "turn-start":
      break;
    case "assistant-text":
      // Step narration is dimmed; only the concluding answer prints plain.
      console.log(event.final ? `\n${event.text}` : c.dim(`\n${event.text}`));
      break;
    case "tool-start":
      console.log(c.dim(`  → ${event.summary}`));
      break;
    case "tool-end":
      if (event.ok) {
        if (event.artifacts?.diff) printDiff(event.artifacts.diff);
        // Execute output is the artifact claims get anchored to — show its tail
        // instead of asking the user to take "tests pass" on faith.
        else if (event.permission === "execute") printOutputTail(event.output);
      } else {
        console.log(c.yellow(`  ✗ ${event.tool}: ${firstLine(event.output)}`));
      }
      break;
    case "tool-denied":
      console.log(c.yellow(`  ⊘ ${event.tool} denied — ${event.reason}`));
      break;
    case "notice":
      console.log(c.dim(`  · ${event.text}`));
      break;
    case "error":
      console.log(c.red(`  ! ${event.message}`));
      break;
    case "turn-end":
      console.log(
        c.dim(
          `  · turn: ${formatUsage(event.turn)} · session: ~$${event.session.costUsd.toFixed(4)}`,
        ),
      );
      break;
  }
}

export function formatUsage(u: UsageTotals): string {
  const cached =
    u.cacheReadTokens > 0
      ? ` (${Math.round((100 * u.cacheReadTokens) / u.inputTokens)}% cached)`
      : "";
  return `${u.inputTokens.toLocaleString()} in${cached} → ${u.outputTokens.toLocaleString()} out tok · ~$${u.costUsd.toFixed(4)}`;
}

function printOutputTail(output: string): void {
  const trimmed = output.trimEnd();
  if (!trimmed) return;
  const lines = trimmed.split("\n");
  const tail = lines.slice(-MAX_OUTPUT_TAIL_LINES);
  if (lines.length > tail.length) {
    console.log(c.dim(`  …[${lines.length - tail.length} more output lines]`));
  }
  for (const line of tail) console.log(c.dim(`  ${line}`));
}

function printDiff(diff: string): void {
  const lines = diff.split("\n");
  const body = lines.slice(0, MAX_DIFF_LINES);
  for (const line of body) {
    if (line.startsWith("+") && !line.startsWith("+++")) console.log(c.green(`  ${line}`));
    else if (line.startsWith("-") && !line.startsWith("---")) console.log(c.red(`  ${line}`));
    else console.log(c.dim(`  ${line}`));
  }
  if (lines.length > MAX_DIFF_LINES) {
    console.log(c.dim(`  …[${lines.length - MAX_DIFF_LINES} more diff lines]`));
  }
}
