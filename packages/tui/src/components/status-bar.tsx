import { Box, Text } from "ink";

export function StatusBar({
  model,
  sessionId,
  costUsd,
}: {
  model: string;
  sessionId: string;
  costUsd: number;
}) {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        ⟠ {model} · session {sessionId.slice(0, 8)} · ~${costUsd.toFixed(4)} · /help · ctrl+c quits
      </Text>
    </Box>
  );
}
