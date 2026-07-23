import { createInterface } from "node:readline/promises";
import type { SessionMeta, SessionStore } from "@semideus/core";

/** One line of the picker list — shared with `demi sessions`' plain listing. */
export function formatSessionLine(s: SessionMeta): string {
  const when = new Date(s.updatedAt).toISOString().slice(0, 16).replace("T", " ");
  return `${s.id.slice(0, 8)}  ${when}  [${s.model}]  ${s.title}`;
}

/**
 * Resolve a picker answer against the listed sessions: a 1-based index into
 * the list as shown, or an id prefix. Empty input cancels. Pure so the
 * matching logic is tested without a real terminal.
 */
export function resolvePick(answer: string, sessions: SessionMeta[]): string | null {
  const trimmed = answer.trim();
  if (!trimmed) return null;
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= sessions.length) {
    return sessions[index - 1]?.id ?? null;
  }
  return sessions.find((s) => s.id.startsWith(trimmed))?.id ?? null;
}

/** Interactive `demi resume --pick`: list sessions, prompt, resolve to an id. */
export async function pickSessionId(
  store: SessionStore,
  /** Scope to one project; omit to offer every session in the database. */
  cwd?: string,
): Promise<string | null> {
  const sessions = store.listSessions(20, cwd);
  if (sessions.length === 0) {
    console.log(
      cwd
        ? "no sessions for this project yet — run `demi` to start one"
        : "no sessions yet — run `demi` to start one",
    );
    return null;
  }
  sessions.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${formatSessionLine(s)}`);
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("resume which? [number or id prefix, enter cancels] › ");
  rl.close();
  const id = resolvePick(answer, sessions);
  if (!id) console.log("  cancelled");
  return id;
}
