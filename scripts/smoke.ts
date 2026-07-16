#!/usr/bin/env bun
/**
 * Live smoke test — one real API round-trip with the `cheap` model, exercising
 * the full path: system prompt → tool schema wire format → permission gate →
 * tool execution → tool result → final prose. Read-only policy; costs well
 * under a cent. Requires ANTHROPIC_API_KEY. Never runs in CI.
 */
import { loadConfig } from "../packages/cli/src/config";
import { formatUsage, printEvent } from "../packages/cli/src/print";
import {
  PermissionGate,
  runTurn,
  Session,
  SessionStore,
  ToolRegistry,
} from "../packages/core/src/index";
import { buildModelSpec, mergedModels } from "../packages/providers/src/index";
import { builtinTools } from "../packages/tools/src/index";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("smoke: ANTHROPIC_API_KEY not set — skipping");
  process.exit(2);
}

const { config } = loadConfig();
const spec = buildModelSpec("cheap", mergedModels(config));

const registry = new ToolRegistry();
for (const tool of builtinTools) registry.register(tool);

// Read-only: a smoke test must not be able to mutate anything.
const gate = new PermissionGate({ read: "allow", write: "deny", execute: "deny", network: "deny" });

const store = new SessionStore(":memory:");
const session = new Session({
  cwd: process.cwd(),
  model: spec,
  registry,
  gate,
  store,
  onEvent: printEvent,
  config: { maxSteps: 6 },
});

await runTurn(
  session,
  "Use the read_file tool to read package.json, then answer in one sentence: what is the package name and what does the workspaces field contain?",
);

console.log(`\nsmoke ok — ${formatUsage(session.usage)} on ${spec.modelName}`);
