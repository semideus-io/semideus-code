import { describe, expect, test } from "bun:test";
import type { DecisionEvent } from "@semideus/core";
import { renderToString } from "ink";
import { MAX_OUTPUT_LINES, WHY_WINDOW, WhyPanel, whyWindow } from "./why-panel";

function decision(step: number, over: Partial<DecisionEvent> = {}): DecisionEvent {
  return {
    ts: step,
    sessionId: "s1",
    step,
    kind: "tool_call",
    summary: `step ${step} happened`,
    rationale: `because of ${step}`,
    refs: [`file${step}.ts`],
    ...over,
  };
}

describe("whyWindow", () => {
  test("shows everything when the log fits", () => {
    expect(whyWindow(4, 0)).toEqual({ start: 0, end: 4 });
    expect(whyWindow(WHY_WINDOW, 3)).toEqual({ start: 0, end: WHY_WINDOW });
  });

  test("centres the cursor once the log is longer than the window", () => {
    const { start, end } = whyWindow(40, 20, 9);
    expect(end - start).toBe(9);
    expect(start).toBe(16);
    expect(20).toBeGreaterThanOrEqual(start);
    expect(20).toBeLessThan(end);
  });

  test("clamps at both ends instead of scrolling past them", () => {
    expect(whyWindow(40, 0, 9)).toEqual({ start: 0, end: 9 });
    expect(whyWindow(40, 39, 9)).toEqual({ start: 31, end: 40 });
  });
});

describe("WhyPanel", () => {
  test("always carries the disclaimer, and pairs rationale with refs", () => {
    const out = renderToString(<WhyPanel decisions={[decision(1)]} cursor={0} expanded={false} />);
    expect(out).toContain("model's stated account");
    expect(out).toContain("because of 1");
    expect(out).toContain("file1.ts");
  });

  test("says so when a step has nothing observable behind it", () => {
    const out = renderToString(
      <WhyPanel
        decisions={[decision(1, { refs: [], rationale: "" })]}
        cursor={0}
        expanded={false}
      />,
    );
    expect(out).toContain("(none stated)");
    expect(out).toContain("nothing observable");
  });

  test("marks the cursor row and windows a long log", () => {
    const decisions = Array.from({ length: 30 }, (_, i) => decision(i + 1));
    const out = renderToString(<WhyPanel decisions={decisions} cursor={20} expanded={false} />);
    expect(out).toContain("▸  21.");
    expect(out).toContain("earlier");
    expect(out).toContain("later");
    // Rows outside the window are not drawn.
    expect(out).not.toContain("step 1 happened");
  });

  test("hides the artifact until expanded, then renders the diff", () => {
    const d = decision(1, { kind: "edit", artifact: { diff: "--- a\n+++ b\n-old\n+new" } });
    const collapsed = renderToString(<WhyPanel decisions={[d]} cursor={0} expanded={false} />);
    expect(collapsed).toContain("enter shows artifact");
    expect(collapsed).not.toContain("+new");

    const open = renderToString(<WhyPanel decisions={[d]} cursor={0} expanded={true} />);
    expect(open).toContain("+new");
    expect(open).toContain("enter hides artifact");
  });

  test("renders command output as evidence, capped", () => {
    const output = Array.from({ length: MAX_OUTPUT_LINES + 5 }, (_, i) => `out ${i}`).join("\n");
    const d = decision(1, { artifact: { output } });
    const open = renderToString(<WhyPanel decisions={[d]} cursor={0} expanded={true} />);
    expect(open).toContain("out 0");
    expect(open).toContain("…[5 more output lines]");
    expect(open).not.toContain(`out ${MAX_OUTPUT_LINES + 4}`);
  });

  test("tells the user when a step simply has no artifact to open", () => {
    const out = renderToString(<WhyPanel decisions={[decision(1)]} cursor={0} expanded={false} />);
    expect(out).toContain("no artifact");
  });
});
