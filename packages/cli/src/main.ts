#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  type AgentEvent,
  type ApprovalDecision,
  type ApprovalRequest,
  PermissionGate,
  type PermissionPolicy,
  runTurn,
  Session,
  type SessionInit,
  SessionStore,
  ToolRegistry,
} from "@semideus/core";
import { buildModelSpec, ConfigError, mergedModels } from "@semideus/providers";
import { buildRepoMap } from "@semideus/repomap";
import { builtinTools } from "@semideus/tools";
import { ApprovalBridge, replayItems, runTui, type TuiHandle } from "@semideus/tui";
import { c } from "./colors";
import { type CommandState, runCommand } from "./commands";
import { loadConfig } from "./config";
import { resolveModelId } from "./model-choice";
import { printDiff, printEvent } from "./print";
import { formatSessionLine, pickSessionId } from "./session-picker";

const VERSION = "0.0.1";

const HELP = `demi — Semideus Code (phase 1)

usage:
  demi                       interactive TUI
  demi -p "task"             one-shot headless run
  demi sessions              list this project's sessions (--all for every project)
  demi resume [id]           resume a session (latest if no id)
  demi resume --pick         choose the session from a list

flags:
  -p, --prompt <text>        run one turn and exit
  -m, --model <id>           model from config (default: "default")
      --pick                 pick the session to resume interactively
      --all                  with "sessions": every project, not just this one
      --yes                  auto-approve all actions (policy setting, gate still runs)
  -h, --help                 this help
  -v, --version              version

commands (TUI):
  /why [n]           decision panel — ↑↓ to move, enter for the diff/output, esc to close
  /cost              token + cost totals for this session
  /undo              restore files from the last mutating action
  /mode              switch default|explain
  /permissions       show the live permission policy ("reset" revokes session grants)
  /help              commands
  /exit              leave (ctrl+c works too)
  esc                interrupt the running turn (progress is kept)`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      prompt: { type: "string", short: "p" },
      // No default: an absent -m must stay distinguishable from "-m default",
      // so a resumed session can fall back to the model it actually ran on.
      model: { type: "string", short: "m" },
      pick: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
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
  if (command === "sessions") return listSessions(values.all === true);
  if (command === "resume")
    return startChat(values, positionals[1] ?? (values.pick ? "pick" : "latest"));
  if (command === "chat") return startChat(values);
  console.error(c.red(`unknown command: ${command}`));
  console.log(HELP);
  process.exitCode = 1;
}

/**
 * Sessions for *this* project by default. demi runs in any repo but keeps one
 * database, so an unscoped list is mostly other projects' history.
 */
function listSessions(all: boolean): void {
  const store = new SessionStore();
  const cwd = process.cwd();
  const sessions = all ? store.listSessions() : store.listSessions(20, cwd);
  if (sessions.length === 0) {
    console.log(
      all
        ? "no sessions yet — run `demi` to start one"
        : "no sessions for this project yet — run `demi` to start one",
    );
  }
  for (const s of sessions) {
    console.log(all ? `${formatSessionLine(s)}  ${c.dim(s.cwd)}` : formatSessionLine(s));
  }
  if (!all) {
    const elsewhere = store.countSessionsElsewhere(cwd);
    if (elsewhere > 0) {
      console.log(c.dim(`  ${elsewhere} more in other projects — demi sessions --all`));
    }
  }
}

interface ChatFlags {
  prompt?: string;
  model?: string;
  yes?: boolean;
}

async function startChat(flags: ChatFlags, resumeId?: string): Promise<void> {
  const { config, path: configPath, created } = loadConfig();

  const store = new SessionStore();

  // "pick" is main()'s sentinel for `resume --pick`; ids are uuids, no collision.
  let resolvedResume = resumeId;
  if (resolvedResume === "pick") {
    if (process.stdin.isTTY !== true) {
      console.error(c.red("--pick needs a terminal"));
      process.exitCode = 1;
      return;
    }
    const picked = await pickSessionId(store, process.cwd());
    if (!picked) return;
    resolvedResume = picked;
  }

  // Resolve "latest" / an id prefix to the full id here: the model choice below
  // needs to load the stored session, and resolution must happen exactly once.
  if (resolvedResume) {
    const full =
      resolvedResume === "latest"
        ? store.latestSessionId(process.cwd())
        : resolveSessionId(store, resolvedResume);
    if (!full) {
      console.error(
        c.red(
          resolvedResume === "latest"
            ? "no sessions to resume in this project"
            : `no session matching "${resolvedResume}"`,
        ),
      );
      process.exitCode = 1;
      return;
    }
    resolvedResume = full;
  }

  // Sessions store the config id, so a resumed local session stays local.
  const models = mergedModels(config);
  const { id: modelId, notice: modelNotice } = resolveModelId(
    flags.model,
    resolvedResume ? store.loadSession(resolvedResume)?.model : undefined,
    models,
  );
  const spec = buildModelSpec(modelId, models);

  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);

  const policy: PermissionPolicy = flags.yes
    ? { read: "allow", write: "allow", execute: "allow", network: "allow" }
    : { ...config.permissions };

  const agentsPath = join(process.cwd(), "AGENTS.md");
  const projectMemory = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
  const repoMap = await safeRepoMap(process.cwd());
  const sessionConfig = { maxSteps: config.limits.max_steps };

  if (flags.prompt) {
    if (created) console.log(c.dim(`wrote default config to ${configPath}`));
    const rl = process.stdin.isTTY
      ? createInterface({ input: process.stdin, output: process.stdout })
      : null;
    // ctrl+c interrupts the turn (state persists via the loop); a second one force-quits.
    const controller = new AbortController();
    const onSigint = () => {
      if (controller.signal.aborted) process.exit(130);
      console.error(c.dim("\ninterrupting — ctrl+c again to force quit"));
      controller.abort();
    };
    process.on("SIGINT", onSigint);
    rl?.on("SIGINT", onSigint); // readline swallows ctrl+c while a question is pending
    const gate = new PermissionGate(
      policy,
      rl ? approvalPrompter(rl, controller.signal) : undefined,
    );
    const opened = openSession(store, resolvedResume, {
      model: spec,
      registry,
      gate,
      onEvent: printEvent,
      config: sessionConfig,
      projectMemory,
      repoMap,
    });
    if (!opened) {
      rl?.close();
      return;
    }
    if (opened.resumedLine) console.log(c.dim(opened.resumedLine));
    if (modelNotice) console.log(c.dim(modelNotice));
    try {
      await runTurn(opened.session, flags.prompt, { signal: controller.signal });
    } catch (err) {
      console.error(c.red(`turn failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
    process.off("SIGINT", onSigint);
    rl?.close();
    return;
  }

  if (process.stdin.isTTY !== true) {
    console.error(c.red('no prompt given and stdin is not a terminal — use -p "task"'));
    process.exitCode = 1;
    return;
  }

  // Interactive: the Ink TUI renders core events; approvals flow through the
  // bridge into the overlay — still through PermissionGate.check, always.
  const bridge = new ApprovalBridge();
  const gate = new PermissionGate(policy, bridge.prompter);
  const sinks = new Set<(event: AgentEvent) => void>();
  const opened = openSession(store, resolvedResume, {
    model: spec,
    registry,
    gate,
    onEvent: (event) => {
      for (const sink of sinks) sink(event);
    },
    config: sessionConfig,
    projectMemory,
    repoMap,
  });
  if (!opened) return;
  const { session } = opened;

  const commandState: CommandState = { whyDisclaimerShown: false };
  let turnController: AbortController | null = null;
  const handle: TuiHandle = {
    subscribe(sink) {
      sinks.add(sink);
      return () => sinks.delete(sink);
    },
    submit: (text) => {
      const controller = new AbortController();
      turnController = controller;
      return runTurn(session, text, { signal: controller.signal }).finally(() => {
        if (turnController === controller) turnController = null;
      });
    },
    interrupt: () => turnController?.abort(),
    command: (line) => runCommand(session, line, commandState, HELP),
    decisions: () => session.decisions(),
  };

  const bannerLines = [
    `model ${spec.id} → ${spec.modelName} · session ${session.id.slice(0, 8)}`,
    "Daimon advises; nothing mutating runs without your yes. /help for commands",
  ];
  if (opened.resumedLine) bannerLines.push(opened.resumedLine);
  if (modelNotice) bannerLines.push(modelNotice);
  if (created) bannerLines.push(`wrote default config to ${configPath}`);

  await runTui({
    handle,
    approvals: bridge,
    banner: { headline: "⟠ demi — Semideus Code", lines: bannerLines },
    model: spec.modelName,
    sessionId: session.id,
    // Resumed history rendered ahead of the live transcript; [] for fresh sessions.
    initialItems: replayItems(session.replay()),
  });
  // A turn (or approval) may still be pending under the unmounted UI — leave nothing dangling.
  process.exit(0);
}

function openSession(
  store: SessionStore,
  resumeId: string | undefined,
  deps: Omit<SessionInit, "store" | "cwd">,
): { session: Session; resumedLine?: string } | null {
  if (resumeId) {
    const id = resumeId === "latest" ? store.latestSessionId() : resolveSessionId(store, resumeId);
    if (!id) {
      console.error(
        c.red(
          resumeId === "latest" ? "no sessions to resume" : `no session matching "${resumeId}"`,
        ),
      );
      process.exitCode = 1;
      return null;
    }
    const session = Session.resume(store, id, deps);
    return {
      session,
      resumedLine: `resumed ${id.slice(0, 8)} — ${session.title()} (${session.messages.length} messages)`,
    };
  }
  return { session: new Session({ ...deps, cwd: process.cwd(), store }) };
}

function resolveSessionId(store: SessionStore, prefix: string): string | null {
  const match = store.listSessions(100).find((s) => s.id.startsWith(prefix));
  return match?.id ?? null;
}

/** The map is a bonus, never a blocker: any failure means no map this session. */
async function safeRepoMap(cwd: string): Promise<string> {
  try {
    const { map } = await buildRepoMap(cwd);
    return map;
  } catch (err) {
    console.error(c.dim(`repo map skipped: ${err instanceof Error ? err.message : String(err)}`));
    return "";
  }
}

/** Readline approvals for headless -p runs from a terminal; the diff still renders first. */
function approvalPrompter(rl: Interface, signal?: AbortSignal) {
  return async (req: ApprovalRequest): Promise<ApprovalDecision> => {
    console.log(c.magenta(`\n  ⟠ approve ${req.toolName} [${req.permission}]`));
    console.log(`    ${req.summary}`);
    if (req.preview?.diff) {
      printDiff(req.preview.diff);
    } else if (req.preview?.command) {
      for (const [i, line] of req.preview.command.split("\n").entries()) {
        console.log(`    ${i === 0 ? "$ " : "  "}${line}`);
      }
    }
    let answer: string;
    try {
      answer = await rl.question(
        c.magenta("    [y]es / [a]lways this session / [N]o › "),
        signal ? { signal } : {},
      );
    } catch {
      return "deny"; // interrupted while waiting — never an implicit yes
    }
    answer = answer.trim().toLowerCase();
    if (answer === "a" || answer === "always") return "allow-session";
    if (answer === "y" || answer === "yes") return "allow";
    return "deny";
  };
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(c.red(err.message));
  } else {
    console.error(c.red(err instanceof Error ? (err.stack ?? err.message) : String(err)));
  }
  process.exit(1);
});
