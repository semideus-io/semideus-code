import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Tool } from "./contracts/tool";
import { type ApprovalRequest, PermissionGate, type PermissionPolicy } from "./permissions";

const writeTool = {
  name: "write_file",
  description: "t",
  schema: z.object({}),
  permission: "write",
  summarize: () => "write something",
  run: async () => ({ ok: true, output: "" }),
} satisfies Tool<z.ZodObject<Record<string, never>>> as unknown as Tool;

function policy(overrides: Partial<PermissionPolicy> = {}): PermissionPolicy {
  return { read: "allow", write: "ask", execute: "ask", network: "ask", ...overrides };
}

describe("PermissionGate", () => {
  test("allow rule passes without a prompter", async () => {
    const gate = new PermissionGate(policy({ write: "allow" }));
    const verdict = await gate.check(writeTool, {}, "s");
    expect(verdict.allowed).toBe(true);
  });

  test("deny rule blocks even when a prompter exists (and never asks)", async () => {
    let asked = false;
    const gate = new PermissionGate(policy({ write: "deny" }), async () => {
      asked = true;
      return "allow";
    });
    const verdict = await gate.check(writeTool, {}, "s");
    expect(verdict.allowed).toBe(false);
    expect(asked).toBe(false);
  });

  test("ask without a prompter denies with an actionable reason", async () => {
    const gate = new PermissionGate(policy());
    const verdict = await gate.check(writeTool, {}, "s");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("--yes");
  });

  test("prompter deny blocks; prompter allow passes once", async () => {
    const answers: ApprovalRequest[] = [];
    let next: "allow" | "deny" = "deny";
    const gate = new PermissionGate(policy(), async (req) => {
      answers.push(req);
      return next;
    });
    expect((await gate.check(writeTool, {}, "s")).allowed).toBe(false);
    next = "allow";
    expect((await gate.check(writeTool, {}, "s")).allowed).toBe(true);
    expect(answers).toHaveLength(2);
    expect(answers[0]?.toolName).toBe("write_file");
  });

  test("allow-session flips the policy so later calls skip the prompt", async () => {
    let asks = 0;
    const gate = new PermissionGate(policy(), async () => {
      asks++;
      return "allow-session";
    });
    expect((await gate.check(writeTool, {}, "s")).allowed).toBe(true);
    expect((await gate.check(writeTool, {}, "s")).allowed).toBe(true);
    expect(asks).toBe(1);
  });

  test("session grants are visible in the effective policy and revocable", async () => {
    let asks = 0;
    const gate = new PermissionGate(policy(), async () => {
      asks++;
      return "allow-session";
    });

    expect(gate.effective().write).toBe("ask");
    await gate.check(writeTool, {}, "s");
    expect(gate.effective().write).toBe("allow");
    expect(gate.sessionGranted()).toEqual(["write"]);

    expect(gate.resetSessionGrants()).toEqual(["write"]);
    expect(gate.effective().write).toBe("ask");
    expect(gate.sessionGranted()).toEqual([]);

    await gate.check(writeTool, {}, "s");
    expect(asks).toBe(2); // asks again once the grant is revoked
  });

  test("reset with nothing granted is a no-op and reports so", () => {
    const gate = new PermissionGate(policy());
    expect(gate.resetSessionGrants()).toEqual([]);
  });
});
