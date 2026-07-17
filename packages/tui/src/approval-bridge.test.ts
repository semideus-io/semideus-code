import { describe, expect, test } from "bun:test";
import type { ApprovalRequest } from "@semideus/core";
import { ApprovalBridge, type PendingApproval } from "./approval-bridge";

const request: ApprovalRequest = {
  toolName: "write_file",
  permission: "write",
  summary: "write a.txt",
  input: {},
};

describe("ApprovalBridge", () => {
  test("prompter surfaces the request and resolves with the user's decision", async () => {
    const bridge = new ApprovalBridge();
    const seen: Array<PendingApproval | null> = [];
    bridge.subscribe((p) => seen.push(p));

    const decision = bridge.prompter(request);
    expect(seen[0]?.request).toBe(request);

    seen[0]?.resolve("allow-session");
    expect(await decision).toBe("allow-session");
    expect(seen.at(-1)).toBeNull();
  });

  test("a subscriber attached late still sees the request in flight", async () => {
    const bridge = new ApprovalBridge();
    const decision = bridge.prompter(request);

    const seen: Array<PendingApproval | null> = [];
    bridge.subscribe((p) => seen.push(p));
    expect(seen[0]?.request).toBe(request);

    seen[0]?.resolve("deny");
    expect(await decision).toBe("deny");
  });

  test("concurrent requests are rejected — the loop asks one at a time", async () => {
    const bridge = new ApprovalBridge();
    const first = bridge.prompter(request);
    await expect(bridge.prompter(request)).rejects.toThrow("already pending");

    // the first request stays answerable
    const seen: Array<PendingApproval | null> = [];
    bridge.subscribe((p) => seen.push(p));
    seen[0]?.resolve("allow");
    expect(await first).toBe("allow");
  });
});
