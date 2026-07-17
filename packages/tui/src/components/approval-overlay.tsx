import type { ApprovalRequest } from "@semideus/core";
import { Box, Text } from "ink";
import { DiffView } from "./diff-view";

/**
 * The permission prompt, with the change itself rendered before the choice:
 * the diff for file mutations, the full command for bash. Deny is the default
 * (Enter/Esc), matching the product contract — nothing runs without a real yes.
 */
export function ApprovalOverlay({ request }: { request: ApprovalRequest }) {
  const preview = request.preview;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      marginTop={1}
    >
      <Text>
        <Text color="magenta">⟠ approve {request.toolName}</Text>
        <Text dimColor> [{request.permission}]</Text>
      </Text>
      <Text>{request.summary}</Text>
      {preview?.diff ? (
        <Box marginTop={1}>
          <DiffView diff={preview.diff} indent="" />
        </Box>
      ) : preview?.command ? (
        <Box marginTop={1} flexDirection="column">
          {preview.command.split("\n").map((line, i) => (
            <Text key={String(i)}>
              {i === 0 ? "$ " : "  "}
              {line || " "}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="magenta">[y]es once · [a]lways this session · [N]o</Text>
      </Box>
    </Box>
  );
}
