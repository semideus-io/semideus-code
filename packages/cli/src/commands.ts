import { formatUsage, type Session } from "@semideus/core";
import { c } from "./colors";

export interface CommandResult {
  lines: string[];
  exit?: boolean;
}

/** Per-session command state (the /why disclaimer shows once per session). */
export interface CommandState {
  whyDisclaimerShown: boolean;
}

/**
 * Slash commands, renderer-agnostic: they return lines instead of printing,
 * so the TUI transcript and any future surface share one implementation.
 * Lines may carry ANSI color — ink Text passes it through.
 */
export async function runCommand(
  session: Session,
  line: string,
  state: CommandState,
  help: string,
): Promise<CommandResult> {
  const [cmd = "", ...rest] = line.slice(1).split(/\s+/);
  switch (cmd) {
    case "exit":
    case "quit":
      return { lines: [], exit: true };
    case "help":
      return { lines: help.split("\n") };
    case "why": {
      const lines: string[] = [];
      if (!state.whyDisclaimerShown) {
        lines.push(
          c.dim(
            "  rationales are the model's stated account, anchored to the artifacts shown — not guaranteed introspection",
          ),
        );
        state.whyDisclaimerShown = true;
      }
      lines.push(...whyLines(session, rest[0]));
      return { lines };
    }
    case "cost":
      return { lines: [`  session: ${formatUsage(session.usage)} (${session.model.modelName})`] };
    case "undo": {
      const restored = await session.undoLast();
      return {
        lines:
          restored.length === 0
            ? ["  nothing to undo"]
            : ["  restored:", ...restored.map((p) => `    ${p}`)],
      };
    }
    case "mode": {
      const mode = rest[0];
      if (mode === "default" || mode === "explain") {
        session.config.mode = mode;
        return { lines: [c.dim(`  mode → ${mode}`)] };
      }
      return {
        lines: [`  current mode: ${session.config.mode} (usage: /mode default|explain)`],
      };
    }
    case "session":
      return { lines: [`  ${session.id} — ${session.title()}`] };
    case "permissions":
      return { lines: permissionLines(session, rest[0]) };
    default:
      return { lines: [c.dim(`  unknown command /${cmd} — /help`)] };
  }
}

function permissionLines(session: Session, arg?: string): string[] {
  if (arg === "reset") {
    const revoked = session.gate.resetSessionGrants();
    return [
      revoked.length === 0
        ? "  no session grants to revoke"
        : `  revoked session grants: ${revoked.join(", ")} — those actions will ask again`,
    ];
  }
  if (arg) {
    return [`  unknown argument "${arg}" (usage: /permissions [reset])`];
  }
  const lines: string[] = [];
  const effective = session.gate.effective();
  const granted = new Set(session.gate.sessionGranted());
  for (const [cls, rule] of Object.entries(effective)) {
    const marker = granted.has(cls as keyof typeof effective) ? c.magenta(" (session grant)") : "";
    lines.push(`  ${cls.padEnd(8)} ${rule}${marker}`);
  }
  if (granted.size > 0) lines.push(c.dim("  /permissions reset revokes session grants"));
  return lines;
}

function whyLines(session: Session, stepArg?: string): string[] {
  const decisions = session.decisions();
  if (decisions.length === 0) return ["  no decisions yet this session"];
  if (stepArg) {
    const step = Number(stepArg);
    const d = decisions.find((x) => x.step === step);
    if (!d) return [`  no step ${stepArg}`];
    const lines = [`  ${d.step}. [${d.kind}] ${d.summary}`];
    if (d.rationale) lines.push(`     why: ${d.rationale}`);
    if (d.refs.length > 0) lines.push(`     refs: ${d.refs.join(" · ")}`);
    return lines;
  }
  return decisions.map((d) => {
    const rationale = d.rationale ? c.dim(` — ${d.rationale}`) : "";
    const refs = d.refs.length > 0 ? c.dim(`  [${d.refs.join(", ")}]`) : "";
    return `  ${String(d.step).padStart(3)}. [${d.kind}] ${d.summary}${rationale}${refs}`;
  });
}
