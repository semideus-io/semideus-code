import { Box, Text } from "ink";

export const MAX_DIFF_LINES = 80;

function diffColor(line: string): "green" | "red" | undefined {
  if (line.startsWith("+") && !line.startsWith("+++")) return "green";
  if (line.startsWith("-") && !line.startsWith("---")) return "red";
  return undefined;
}

/** A unified diff, additions green and removals red, capped at MAX_DIFF_LINES. */
export function DiffView({ diff, indent = "  " }: { diff: string; indent?: string }) {
  const lines = diff.trimEnd().split("\n");
  const body = lines.slice(0, MAX_DIFF_LINES);
  return (
    <Box flexDirection="column">
      {body.map((line, i) => {
        const color = diffColor(line);
        return (
          <Text key={String(i)} color={color} dimColor={color === undefined}>
            {indent}
            {line || " "}
          </Text>
        );
      })}
      {lines.length > MAX_DIFF_LINES ? (
        <Text dimColor>
          {indent}…[{lines.length - MAX_DIFF_LINES} more diff lines]
        </Text>
      ) : null}
    </Box>
  );
}
