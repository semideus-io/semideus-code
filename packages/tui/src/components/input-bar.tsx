import { Box, Text } from "ink";

/** The prompt line. Editing is handled by the app's useInput; this only draws. */
export function InputBar({ value }: { value: string }) {
  return (
    <Box>
      <Text color="cyan">you › </Text>
      <Text>{value}</Text>
      <Text inverse> </Text>
    </Box>
  );
}
