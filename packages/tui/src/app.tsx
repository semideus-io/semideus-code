import { Box, Text } from "ink";

/**
 * Phase 1 builds the real app here: a <Static> transcript of finished events,
 * a live region for the streaming turn, and modal overlays for approvals,
 * plan preview, diff view and /why — rendering core AgentEvents only.
 * The TUI owns no agent state; it is a renderer of the core event stream.
 */
export function Banner({ model }: { model: string }) {
  return (
    <Box flexDirection="column">
      <Text color="magenta">⟠ demi — Semideus Code</Text>
      <Text dimColor>{model}</Text>
    </Box>
  );
}
