import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import { ApprovalOverlay } from "./components/approval-overlay";
import { DiffView, MAX_DIFF_LINES } from "./components/diff-view";
import { OutputTail, TranscriptLine } from "./components/transcript-line";
import type { TranscriptItem } from "./transcript";

describe("DiffView", () => {
  test("renders additions and removals, capping long diffs", () => {
    const short = renderToString(<DiffView diff={"--- a\n+++ b\n-old\n+new"} />);
    expect(short).toContain("-old");
    expect(short).toContain("+new");

    const long = Array.from({ length: MAX_DIFF_LINES + 20 }, (_, i) => `+row${i}`).join("\n");
    const capped = renderToString(<DiffView diff={long} />);
    expect(capped).toContain(`+row${MAX_DIFF_LINES - 1}`);
    expect(capped).toContain("…[20 more diff lines]");
    expect(capped).not.toContain(`+row${MAX_DIFF_LINES + 19}`);
  });
});

describe("OutputTail", () => {
  test("shows the last lines with a dropped-count header", () => {
    const output = Array.from({ length: 14 }, (_, i) => `row${String(i).padStart(2, "0")}`).join(
      "\n",
    );
    const out = renderToString(<OutputTail output={output} />);
    expect(out).toContain("…[4 more output lines]");
    expect(out).toContain("row13");
    expect(out).not.toContain("row03");
  });
});

describe("TranscriptLine", () => {
  test("tool-end renders the diff when present, the tail for execute, nothing for reads", () => {
    const diffItem: TranscriptItem = {
      kind: "tool-end",
      tool: "edit_file",
      ok: true,
      output: "edited a.ts",
      permission: "write",
      artifacts: { path: "a.ts", diff: "-old\n+new" },
    };
    expect(renderToString(<TranscriptLine item={diffItem} />)).toContain("+new");

    const execItem: TranscriptItem = {
      kind: "tool-end",
      tool: "bash",
      ok: true,
      output: "exit code: 0\nhello",
      permission: "execute",
    };
    expect(renderToString(<TranscriptLine item={execItem} />)).toContain("hello");

    const readItem: TranscriptItem = {
      kind: "tool-end",
      tool: "read_file",
      ok: true,
      output: "file contents",
      permission: "read",
    };
    expect(renderToString(<TranscriptLine item={readItem} />)).toBe("");

    const failed: TranscriptItem = {
      kind: "tool-end",
      tool: "edit_file",
      ok: false,
      output: "old_string not found\ndetail",
      permission: "write",
    };
    expect(renderToString(<TranscriptLine item={failed} />)).toContain(
      "✗ edit_file: old_string not found",
    );
  });

  test("narration dims, conclusions do not", () => {
    const narration: TranscriptItem = { kind: "assistant", text: "checking", final: false };
    const conclusion: TranscriptItem = { kind: "assistant", text: "done", final: true };
    expect(renderToString(<TranscriptLine item={narration} />)).toContain("checking");
    expect(renderToString(<TranscriptLine item={conclusion} />)).toContain("done");
  });
});

describe("ApprovalOverlay", () => {
  test("the diff is on screen before the choice", () => {
    const out = renderToString(
      <ApprovalOverlay
        request={{
          toolName: "edit_file",
          permission: "write",
          summary: "edit a.ts",
          input: {},
          preview: { path: "a.ts", diff: "-old\n+new" },
        }}
      />,
    );
    expect(out).toContain("approve edit_file");
    expect(out).toContain("edit a.ts");
    expect(out).toContain("+new");
    expect(out.indexOf("+new")).toBeLessThan(out.indexOf("[y]es once"));
  });

  test("bash approvals show the full command, not the summary", () => {
    const out = renderToString(
      <ApprovalOverlay
        request={{
          toolName: "bash",
          permission: "execute",
          summary: "$ echo one…",
          input: {},
          preview: { command: "echo one\necho two" },
        }}
      />,
    );
    expect(out).toContain("echo one");
    expect(out).toContain("echo two");
  });

  test("without a preview the summary carries the prompt, deny stays default", () => {
    const out = renderToString(
      <ApprovalOverlay
        request={{ toolName: "write_file", permission: "write", summary: "write x", input: {} }}
      />,
    );
    expect(out).toContain("write x");
    expect(out).toContain("[N]o");
  });
});
