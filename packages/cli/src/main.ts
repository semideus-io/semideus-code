#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  type ApprovalDecision,
  type ApprovalRequest,
  PermissionGate,
  type PermissionPolicy,
  runTurn,
  Session,
  SessionStore,
  ToolRegistry,
} from "@semideus/core";
import { buildModelSpec, ConfigError, mergedModels } from "@semideus/providers";
import { builtinTools } from "@semideus/tools";
import { c } from "./colors";
import { loadConfig } from "./config";
import { formatUsage, printEvent } from "./print";

const VERSION = "0.0.1";

const HELP = `demi — Semideus Code (phase 0)

usage:
  demi                       interactive REPL
  demi -p "task"             one-shot headless run
  demi sessions              list stored sessions
  demi resume [id]           resume a session (latest if no id)

flags:
  -p, --prompt <text>        run one turn and exit
  -m, --model <id>           model from config (default: "default")
      --yes                  auto-approve all actions (policy setting, gate still runs)
  -h, --help                 this help
  -v, --version              version

in the REPL:
  /why [n]    decision log — every action with its stated rationale and artifacts
  /cost       token + cost totals for this session
  /undo       restore files from the last mutating action
  /mode       switch default|explain
  /help       commands`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      prompt: { type: "string", short: "p" },
      model: { type: "string", short: "m", default: "default" },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.version) {
    console.log(`demi ${VERSION}`);
    return;
  }

  const command = positionals[0] ?? "chat";
  if (command === "sessions") return listSessions();
  if (command === "resume") return startChat(values, positionals[1] ?? "latest");
  if (command === "chat") return startChat(values);
  console.error(c.red(`unknown command: ${command}`));
  console.log(HELP);
  process.exitCode = 1;
}

function listSessions(): void {
  const store = new SessionStore();
  const sessions = store.listSessions();
  if (sessions.length === 0) {
    console.log("no sessions yet — run `demi` to start one");
    return;
  }
  for (const s of sessions) {
    const when = new Date(s.updatedAt).toISOString().slice(0, 16).replace("T", " ");
    console.log(`${s.id.slice(0, 8)}  ${when}  [${s.model}]  ${s.title}`);
  }
}

interface ChatFlags {
  prompt?: string;
  model?: string;
  yes?: boolean;
}

async function startChat(flags: ChatFlags, resumeId?: string): Promise<void> {
  const { config, path: configPath, created } = loadConfig();
  if (created) {
    console.log(c.dim(`wrote default config to ${configPath}`));
  }

  const spec = buildModelSpec(flags.model ?? "default", mergedModels(config));
  const store = new SessionStore();

  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);

  const policy: PermissionPolicy = flags.yes
    ? { read: "allow", write: "allow", execute: "allow", network: "allow" }
    : { ...config.permissions };

  const interactive = process.stdin.isTTY === true && !flags.prompt;
  const rl = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const gate = new PermissionGate(policy, rl ? approvalPrompter(rl) : undefined);

  const agentsPath = join(process.cwd(), "AGENTS.md");
  const projectMemory = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";

  const deps = {
    model: spec,
    registry,
    gate,
    onEvent: printEvent,
    config: { maxSteps: config.limits.max_steps },
    projectMemory,
  };

  let session: Session;
  if (resumeId) {
    const id = resumeId === "latest" ? store.latestSessionId() : resolveSessionId(store, resumeId);
    if (!id) {
      console.error(
        c.red(
          resumeId === "latest" ? "no sessions to resume" : `no session matching "${resumeId}"`,
        ),
      );
      process.exitCode = 1;
      rl?.close();
      return;
    }
    session = Session.resume(store, id, deps);
    console.log(
      c.dim(`resumed ${id.slice(0, 8)} — ${session.title()} (${session.messages.length} messages)`),
    );
  } else {
    session = new Session({ ...deps, cwd: process.cwd(), store });
  }

  if (flags.prompt) {
    try {
      await runTurn(session, flags.prompt);
    } catch (err) {
      console.error(c.red(`turn failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
    rl?.close();
    return;
  }

  if (!interactive || !rl) {
    console.error(c.red('no prompt given and stdin is not a terminal — use -p "task"'));
    process.exitCode = 1;
    rl?.close();
    return;
  }

  await repl(session, rl);
}

function resolveSessionId(store: SessionStore, prefix: string): string | null {
  const match = store.listSessions(100).find((s) => s.id.startsWith(prefix));
  return match?.id ?? null;
}

function approvalPrompter(rl: Interface) {
  return async (req: ApprovalRequest): Promise<ApprovalDecision> => {
    console.log(c.magenta(`\n  ⟠ approve ${req.toolName} [${req.permission}]`));
    console.log(`    ${req.summary}`);
    const answer = (await rl.question(c.magenta("    [y]es / [a]lways this session / [N]o › ")))
      .trim()
      .toLowerCase();
    if (answer === "a" || answer === "always") return "allow-session";
    if (answer === "y" || answer === "yes") return "allow";
    return "deny";
  };
}

async function repl(session: Session, rl: Interface): Promise<void> {
  console.log(c.magenta("⟠ demi — Semideus Code"));
  console.log(
    c.dim(
      `  model ${session.model.id} → ${session.model.modelName} · session ${session.id.slice(0, 8)}`,
    ),
  );
  console.log(
    c.dim("  Daimon advises; nothing mutating runs without your yes. /help for commands"),
  );

  let whyDisclaimerShown = false;

  for (;;) {
    let line: string;
    try {
      line = (await rl.question(c.cyan("\nyou › "))).trim();
    } catch {
      break; // stdin closed (ctrl-d / ctrl-c)
    }
    if (!line) continue;

    if (line.startsWith("/")) {
      const [cmd, ...rest] = line.slice(1).split(/\s+/);
      switch (cmd) {
        case "exit":
        case "quit":
          rl.close();
          return;
        case "help":
          console.log(HELP);
          break;
        case "why": {
          if (!whyDisclaimerShown) {
            console.log(
              c.dim(
                "  rationales are the model's stated account, anchored to the artifacts shown — not guaranteed introspection",
              ),
            );
            whyDisclaimerShown = true;
          }
          printWhy(session, rest[0]);
          break;
        }
        case "cost":
          console.log(`  ${formatUsage(session.usage)} (${session.model.modelName})`);
          break;
        case "undo": {
          const restored = await session.undoLast();
          console.log(
            restored.length === 0
              ? "  nothing to undo"
              : `  restored:\n${restored.map((p) => `    ${p}`).join("\n")}`,
          );
          break;
        }
        case "mode": {
          const mode = rest[0];
          if (mode === "default" || mode === "explain") {
            session.config.mode = mode;
            console.log(c.dim(`  mode → ${mode}`));
          } else {
            console.log(`  current mode: ${session.config.mode} (usage: /mode default|explain)`);
          }
          break;
        }
        case "session":
          console.log(`  ${session.id} — ${session.title()}`);
          break;
        default:
          console.log(c.dim(`  unknown command /${cmd} — /help`));
      }
      continue;
    }

    try {
      await runTurn(session, line);
    } catch (err) {
      console.error(c.red(`turn failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}

function printWhy(session: Session, stepArg?: string): void {
  const decisions = session.decisions();
  if (decisions.length === 0) {
    console.log("  no decisions yet this session");
    return;
  }
  if (stepArg) {
    const step = Number(stepArg);
    const d = decisions.find((x) => x.step === step);
    if (!d) {
      console.log(`  no step ${stepArg}`);
      return;
    }
    console.log(`  ${d.step}. [${d.kind}] ${d.summary}`);
    if (d.rationale) console.log(`     why: ${d.rationale}`);
    if (d.refs.length > 0) console.log(`     refs: ${d.refs.join(" · ")}`);
    return;
  }
  for (const d of decisions) {
    const rationale = d.rationale ? c.dim(` — ${d.rationale}`) : "";
    const refs = d.refs.length > 0 ? c.dim(`  [${d.refs.join(", ")}]`) : "";
    console.log(`  ${String(d.step).padStart(3)}. [${d.kind}] ${d.summary}${rationale}${refs}`);
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(c.red(err.message));
  } else {
    console.error(c.red(err instanceof Error ? (err.stack ?? err.message) : String(err)));
  }
  process.exit(1);
});
