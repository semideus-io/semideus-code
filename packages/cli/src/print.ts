import type { AgentEvent, UsageTotals } from "@semideus/core";
import { firstLine } from "@semideus/core";
import { c } from "./colors";

const MAX_DIFF_LINES = 80;

export function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case "turn-start":
      break;
    case "assistant-text":
      console.log(`\n${event.text}`);
      break;
    case "tool-start":
      console.log(c.dim(`  → ${event.summary}`));
      break;
    case "tool-end":
      if (event.ok) {
        if (event.artifacts?.diff) printDiff(event.artifacts.diff);
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
      console.log(c.dim(`  · ${formatUsage(event.usage)}`));
      break;
  }
}

export function formatUsage(u: UsageTotals): string {
  return `${u.inputTokens.toLocaleString()} in → ${u.outputTokens.toLocaleString()} out tok · ~$${u.costUsd.toFixed(4)}`;
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
