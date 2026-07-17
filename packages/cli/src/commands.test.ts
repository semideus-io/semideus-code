import { describe, expect, test } from "bun:test";
import type { ModelSpec, Tool } from "@semideus/core";
import { PermissionGate, Session, SessionStore, ToolRegistry } from "@semideus/core";
import { type CommandState, runCommand } from "./commands";

const HELP = "line one\nline two";

function makeSession(gate?: PermissionGate): Session {
  const spec: ModelSpec = {
    id: "mock",
    // never called by commands
    model: null as unknown as ModelSpec["model"],
    modelName: "mock-model",
    contextWindow: 8_000,
    toolMode: "native",
    costPerMTok: { in: 1, out: 2 },
  };
  return new Session({
    cwd: process.cwd(),
    model: spec,
    registry: new ToolRegistry(),
    gate:
      gate ?? new PermissionGate({ read: "allow", write: "ask", execute: "ask", network: "ask" }),
    store: new SessionStore(":memory:"),
  });
}

function state(): CommandState {
  return { whyDisclaimerShown: false };
}

async function lines(session: Session, line: string, s = state()): Promise<string[]> {
  return (await runCommand(session, line, s, HELP)).lines;
}

describe("runCommand", () => {
  test("/exit signals exit without output", async () => {
    const result = await runCommand(makeSession(), "/exit", state(), HELP);
    expect(result.exit).toBe(true);
    expect(result.lines).toEqual([]);
  });

  test("/help returns the help text as lines", async () => {
    expect(await lines(makeSession(), "/help")).toEqual(["line one", "line two"]);
  });

  test("/cost names the model", async () => {
    const out = await lines(makeSession(), "/cost");
    expect(out[0]).toContain("session:");
    expect(out[0]).toContain("mock-model");
  });

  test("/mode switches and validates", async () => {
    const session = makeSession();
    await lines(session, "/mode explain");
    expect(session.config.mode).toBe("explain");
    const bogus = await lines(session, "/mode bogus");
    expect(bogus[0]).toContain("usage: /mode default|explain");
    expect(session.config.mode).toBe("explain");
  });

  test("/why shows its disclaimer once per session", async () => {
    const session = makeSession();
    const shared = state();
    const first = await lines(session, "/why", shared);
    expect(first[0]).toContain("stated account");
    expect(first[1]).toContain("no decisions yet");
    const second = await lines(session, "/why", shared);
    expect(second[0]).toContain("no decisions yet");
  });

  test("/permissions shows the live policy and reset revokes grants", async () => {
    // the gate only reads name + permission; schema stays out of cli's deps
    const writeTool = {
      name: "write_file",
      description: "t",
      permission: "write",
      summarize: () => "write",
      run: async () => ({ ok: true, output: "" }),
    } as unknown as Tool;
    const gate = new PermissionGate(
      { read: "allow", write: "ask", execute: "ask", network: "ask" },
      async () => "allow-session",
    );
    const session = makeSession(gate);
    await gate.check(writeTool, {}, "s");

    const shown = await lines(session, "/permissions");
    expect(shown.find((l) => l.startsWith("  write"))).toContain("allow");
    expect(shown.find((l) => l.startsWith("  write"))).toContain("session grant");

    const reset = await lines(session, "/permissions reset");
    expect(reset[0]).toContain("revoked session grants: write");
    const after = await lines(session, "/permissions");
    expect(after.find((l) => l.startsWith("  write"))).toContain("ask");
  });

  test("/undo with nothing to undo says so", async () => {
    expect((await lines(makeSession(), "/undo"))[0]).toContain("nothing to undo");
  });

  test("unknown commands point at /help", async () => {
    expect((await lines(makeSession(), "/wat"))[0]).toContain("unknown command /wat");
  });
});
