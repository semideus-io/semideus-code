import type { DecisionEvent } from "@semideus/core";
import { Box, Text } from "ink";
import { DiffView } from "./diff-view";

/** Rows of the decision list kept on screen; the cursor stays centred within it. */
export const WHY_WINDOW = 9;
/** Command output is the evidence, but a panel is not a pager. */
export const MAX_OUTPUT_LINES = 14;

/**
 * Which slice of the list to draw. Short logs render whole; longer ones scroll
 * with the cursor centred, clamped so the window never runs past either end.
 */
export function whyWindow(
  count: number,
  cursor: number,
  size: number = WHY_WINDOW,
): { start: number; end: number } {
  if (count <= size) return { start: 0, end: count };
  const half = Math.floor(size / 2);
  const start = Math.min(Math.max(0, cursor - half), count - size);
  return { start, end: start + size };
}

function kindColor(kind: DecisionEvent["kind"]): string | undefined {
  if (kind === "edit") return "yellow";
  if (kind === "conclusion") return "green";
  return undefined;
}

/**
 * The glass box, navigable. Every entry pairs the model's *stated* rationale
 * with the artifact that makes it checkable — a diff, or what a command
 * actually printed. The disclaimer is part of the panel, not a one-time notice:
 * a surface that shows rationale carries the caveat every time it's open.
 */
export function WhyPanel({
  decisions,
  cursor,
  expanded,
}: {
  decisions: DecisionEvent[];
  cursor: number;
  expanded: boolean;
}) {
  const { start, end } = whyWindow(decisions.length, cursor);
  const selected = decisions[cursor];
  const artifact = selected?.artifact;
  const hasArtifact = Boolean(artifact?.diff || artifact?.output);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      marginTop={1}
    >
      <Text>
        <Text color="magenta">⟠ why</Text>
        <Text dimColor>
          {" "}
          · {decisions.length} decision{decisions.length === 1 ? "" : "s"} · ↑↓ move ·{" "}
          {hasArtifact
            ? expanded
              ? "enter hides artifact"
              : "enter shows artifact"
            : "no artifact"}{" "}
          · esc close
        </Text>
      </Text>
      <Text dimColor>
        rationales are the model's stated account, anchored to the artifacts shown — not guaranteed
        introspection
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {start > 0 ? <Text dimColor> ↑ {start} earlier</Text> : null}
        {decisions.slice(start, end).map((d, i) => {
          const index = start + i;
          const active = index === cursor;
          return (
            <Text key={`${d.step}-${d.ts}`} color={active ? "magenta" : undefined}>
              {active ? "▸ " : "  "}
              {String(d.step).padStart(3)}. <Text color={kindColor(d.kind)}>[{d.kind}]</Text>{" "}
              {d.summary}
            </Text>
          );
        })}
        {end < decisions.length ? <Text dimColor> ↓ {decisions.length - end} later</Text> : null}
      </Box>

      {selected ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text dimColor>why: </Text>
            {selected.rationale || <Text dimColor>(none stated)</Text>}
          </Text>
          {selected.alternatives?.length ? (
            <Text dimColor>considered: {selected.alternatives.join(" · ")}</Text>
          ) : null}
          {selected.refs.length > 0 ? (
            <Text dimColor>refs: {selected.refs.join(" · ")}</Text>
          ) : (
            <Text dimColor>refs: none — nothing observable to check this against</Text>
          )}
          {expanded && artifact?.diff ? (
            <Box marginTop={1}>
              <DiffView diff={artifact.diff} indent="" />
            </Box>
          ) : null}
          {expanded && artifact?.output ? <OutputBlock output={artifact.output} /> : null}
        </Box>
      ) : null}
    </Box>
  );
}

function OutputBlock({ output }: { output: string }) {
  const lines = output.trimEnd().split("\n");
  const shown = lines.slice(0, MAX_OUTPUT_LINES);
  return (
    <Box flexDirection="column" marginTop={1}>
      {shown.map((line, i) => (
        <Text key={String(i)} dimColor>
          {line || " "}
        </Text>
      ))}
      {lines.length > MAX_OUTPUT_LINES ? (
        <Text dimColor>…[{lines.length - MAX_OUTPUT_LINES} more output lines]</Text>
      ) : null}
    </Box>
  );
}
