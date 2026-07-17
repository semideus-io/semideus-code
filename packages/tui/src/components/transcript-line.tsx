import { firstLine, formatUsage } from "@semideus/core";
import { Box, Text } from "ink";
import type { TranscriptItem } from "../transcript";
import { DiffView } from "./diff-view";

export const MAX_OUTPUT_TAIL_LINES = 10;

const APPROVAL_LABELS = {
  allow: "approved once",
  "allow-session": "approved for this session",
  deny: "denied",
} as const;

/** Execute output is the artifact claims get anchored to — show its tail. */
export function OutputTail({ output }: { output: string }) {
  const trimmed = output.trimEnd();
  if (!trimmed) return null;
  const lines = trimmed.split("\n");
  const tail = lines.slice(-MAX_OUTPUT_TAIL_LINES);
  return (
    <Box flexDirection="column">
      {lines.length > tail.length ? (
        <Text dimColor>
          {"  "}…[{lines.length - tail.length} more output lines]
        </Text>
      ) : null}
      {tail.map((line, i) => (
        <Text key={String(i)} dimColor>
          {"  "}
          {line || " "}
        </Text>
      ))}
    </Box>
  );
}

/** One finished transcript item — the TUI twin of cli/print.ts, same shapes. */
export function TranscriptLine({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "banner":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="magenta">{item.headline}</Text>
          {item.lines.map((line, i) => (
            <Text key={String(i)} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      );
    case "user":
      return (
        <Box marginTop={1}>
          <Text>
            <Text color="cyan">you › </Text>
            {item.text}
          </Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={1}>
          {/* Step narration is dimmed; only the concluding answer prints plain. */}
          <Text dimColor={!item.final}>{item.text}</Text>
        </Box>
      );
    case "tool-start":
      return (
        <Text dimColor>
          {"  "}→ {item.summary}
        </Text>
      );
    case "tool-end":
      if (!item.ok) {
        return (
          <Text color="yellow">
            {"  "}✗ {item.tool}: {firstLine(item.output)}
          </Text>
        );
      }
      if (item.artifacts?.diff) return <DiffView diff={item.artifacts.diff} />;
      if (item.permission === "execute") return <OutputTail output={item.output} />;
      return null;
    case "denied":
      return (
        <Text color="yellow">
          {"  "}⊘ {item.tool} denied — {item.reason}
        </Text>
      );
    case "approval":
      return (
        <Text dimColor>
          {"  "}⟠ {APPROVAL_LABELS[item.decision]} — {item.tool}
        </Text>
      );
    case "notice":
      return (
        <Text dimColor>
          {"  "}· {item.text}
        </Text>
      );
    case "error":
      return (
        <Text color="red">
          {"  "}! {item.text}
        </Text>
      );
    case "cost":
      return (
        <Text dimColor>
          {"  "}· turn: {formatUsage(item.turn)} · session: ~${item.session.costUsd.toFixed(4)}
        </Text>
      );
    case "info":
      return (
        <Box flexDirection="column">
          {item.lines.map((line, i) => (
            <Text key={String(i)}>{line || " "}</Text>
          ))}
        </Box>
      );
  }
}
