export function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0] ?? "";
}

/** Keep head and tail, drop the middle — errors usually live at the end. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.25);
  const tail = max - head;
  const dropped = text.length - head - tail;
  return `${text.slice(0, head)}\n…[${dropped} chars truncated]…\n${text.slice(-tail)}`;
}

/**
 * The model's stated why for the tool calls in a response: the last one or two
 * sentences of the text that preceded them. A stated account, not introspection.
 */
export function extractRationale(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const paragraph = trimmed.split(/\n{2,}/).at(-1) ?? "";
  const flat = paragraph.replace(/\n/g, " ").trim();
  const sentences = flat.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  const rationale = sentences ? sentences.slice(-2).join(" ") : flat;
  return rationale.trim().slice(0, 280);
}
