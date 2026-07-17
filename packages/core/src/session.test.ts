import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "./contracts/events";
import type { ModelSpec } from "./contracts/provider";
import { PermissionGate } from "./permissions";
import { ToolRegistry } from "./registry";
import { Session } from "./session";
import { SessionStore } from "./store";

function makeSession(events: AgentEvent[], contextWindow: number): Session {
  const spec: ModelSpec = {
    id: "mock",
    model: {} as ModelSpec["model"], // trackUsage never touches the model itself
    modelName: "mock-model",
    contextWindow,
    toolMode: "native",
    costPerMTok: { in: 1, out: 2 },
  };
  return new Session({
    cwd: process.cwd(),
    model: spec,
    registry: new ToolRegistry(),
    gate: new PermissionGate({ read: "allow", write: "ask", execute: "ask", network: "ask" }),
    store: new SessionStore(":memory:"),
    onEvent: (e) => events.push(e),
  });
}

const notices = (events: AgentEvent[]) => events.filter((e) => e.type === "notice");

describe("context warning", () => {
  test("stays silent below 70% of the window", () => {
    const events: AgentEvent[] = [];
    const s = makeSession(events, 10_000);
    s.trackUsage({ inputTokens: 6_999, outputTokens: 5 });
    expect(notices(events)).toEqual([]);
  });

  test("warns once crossing 70%, with the share in the text — then never again", () => {
    const events: AgentEvent[] = [];
    const s = makeSession(events, 10_000);
    s.trackUsage({ inputTokens: 7_000, outputTokens: 5 });
    s.trackUsage({ inputTokens: 8_500, outputTokens: 5 });

    const warned = notices(events);
    expect(warned).toHaveLength(1);
    expect(warned[0]?.type === "notice" && warned[0].text).toContain("70%");
    expect(warned[0]?.type === "notice" && warned[0].text).toContain("10k");
  });

  test("per-step prompt size triggers it, not the session total", () => {
    const events: AgentEvent[] = [];
    const s = makeSession(events, 10_000);
    // Five small steps: 5 × 2k = 10k total, but no single prompt near the window.
    for (let i = 0; i < 5; i++) s.trackUsage({ inputTokens: 2_000, outputTokens: 5 });
    expect(notices(events)).toEqual([]);
  });
});
