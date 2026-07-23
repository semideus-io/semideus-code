import type { ApprovalDecision, DecisionEvent, EventSink } from "@semideus/core";
import { Box, Static, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalBridge, PendingApproval } from "./approval-bridge";
import { ApprovalOverlay } from "./components/approval-overlay";
import { InputBar } from "./components/input-bar";
import { StatusBar } from "./components/status-bar";
import { TranscriptLine } from "./components/transcript-line";
import { WhyPanel } from "./components/why-panel";
import { type TranscriptItem, transcriptItem } from "./transcript";

/** Streamed deltas are batched into the live region at this cadence. */
const LIVE_FLUSH_MS = 40;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface CommandResult {
  lines: string[];
  exit?: boolean;
}

/**
 * Everything the TUI may do to the world, injected by the cli. The TUI owns
 * no agent state: it renders events and forwards input.
 */
export interface TuiHandle {
  /** Subscribe to the session's AgentEvents. Returns the unsubscribe. */
  subscribe(sink: EventSink): () => void;
  /** Run one agent turn. Resolves after turn-end. */
  submit(text: string): Promise<void>;
  /** Interrupt the running turn, if any. The turn still ends via submit's resolve. */
  interrupt(): void;
  /** Execute a slash command, returning transcript lines (may be ANSI-colored). */
  command(line: string): Promise<CommandResult>;
  /** The session's decision log, for the /why panel. Read-only snapshot. */
  decisions(): DecisionEvent[];
}

export interface AppProps {
  handle: TuiHandle;
  approvals: ApprovalBridge;
  banner: { headline: string; lines: string[] };
  model: string;
  sessionId: string;
  /** A resumed session's replayed history, rendered ahead of the live transcript. */
  initialItems?: TranscriptItem[];
}

type KeyedItem = TranscriptItem & { id: number };

/** Open-panel state: the decisions snapshotted at open, plus cursor and detail. */
interface WhyState {
  decisions: DecisionEvent[];
  cursor: number;
  expanded: boolean;
}

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 100);
    return () => clearInterval(timer);
  }, []);
  return <Text color="magenta">{SPINNER_FRAMES[frame] ?? "⠋"}</Text>;
}

export function App({ handle, approvals, banner, model, sessionId, initialItems }: AppProps) {
  const { exit } = useApp();
  const nextId = useRef(1);
  const [items, setItems] = useState<KeyedItem[]>(() => {
    const seed: TranscriptItem[] = [{ kind: "banner", ...banner }, ...(initialItems ?? [])];
    return seed.map((item) => ({ ...item, id: nextId.current++ }));
  });
  const [live, setLive] = useState("");
  const liveRef = useRef("");
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [input, setInput] = useState("");
  // Mirror of `input` for the key handler: chunks can arrive faster than renders.
  const inputRef = useRef("");
  const [sessionCost, setSessionCost] = useState(0);
  // Non-null while the /why panel is open; it owns the keyboard until esc.
  const [why, setWhy] = useState<WhyState | null>(null);

  const setBuffer = useCallback((value: string) => {
    inputRef.current = value;
    setInput(value);
  }, []);

  const append = useCallback((item: TranscriptItem) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { ...item, id }]);
  }, []);

  useEffect(() => {
    return handle.subscribe((event) => {
      if (event.type === "assistant-delta") {
        // Ref only — the flush interval turns deltas into at most 25 paints/s.
        liveRef.current += event.text;
        return;
      }
      if (event.type === "assistant-text" || event.type === "turn-end") {
        liveRef.current = "";
        setLive("");
      }
      if (event.type === "turn-end") setSessionCost(event.session.costUsd);
      const item = transcriptItem(event);
      if (item) append(item);
    });
  }, [handle, append]);

  useEffect(() => approvals.subscribe(setPending), [approvals]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setLive((prev) => (prev === liveRef.current ? prev : liveRef.current));
    }, LIVE_FLUSH_MS);
    return () => clearInterval(timer);
  }, [running]);

  /**
   * `/why` is the one command the TUI answers itself: headless prints lines,
   * here it opens a navigable panel over the same decision log. The cursor
   * starts on the newest step — "why did you just do that" is the live question.
   */
  const openWhy = useCallback(
    (arg: string) => {
      const decisions = handle.decisions();
      if (decisions.length === 0) {
        append({ kind: "info", lines: ["  no decisions yet this session"] });
        return;
      }
      const found = arg ? decisions.findIndex((d) => d.step === Number(arg)) : -1;
      if (arg && found === -1) {
        append({ kind: "info", lines: [`  no step ${arg}`] });
        return;
      }
      setWhy({
        decisions,
        cursor: found === -1 ? decisions.length - 1 : found,
        // An explicit /why N means "show me that one" — open its artifact too.
        expanded: found !== -1,
      });
    },
    [handle, append],
  );

  const handleLine = useCallback(
    (line: string) => {
      append({ kind: "user", text: line });
      if (line.startsWith("/")) {
        const [cmd = "", ...rest] = line.slice(1).split(/\s+/);
        if (cmd === "why") {
          openWhy(rest[0] ?? "");
          return;
        }
        void handle.command(line).then((result) => {
          if (result.lines.length > 0) append({ kind: "info", lines: result.lines });
          if (result.exit) exit();
        });
        return;
      }
      setRunning(true);
      void handle
        .submit(line)
        .catch((err) => {
          append({
            kind: "error",
            text: `turn failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        })
        .finally(() => setRunning(false));
    },
    [handle, append, exit, openWhy],
  );

  useInput((char, key) => {
    if (pending) {
      const pressed = char.toLowerCase();
      let decision: ApprovalDecision | null = null;
      if (pressed === "y") decision = "allow";
      else if (pressed === "a") decision = "allow-session";
      else if (pressed === "n" || key.escape || key.return) decision = "deny";
      if (decision) {
        // The transcript records what the human chose — part of the glass box.
        append({ kind: "approval", tool: pending.request.toolName, decision });
        pending.resolve(decision);
      }
      return;
    }
    if (why) {
      // The panel owns the keyboard while open — nothing reaches the input buffer.
      if (key.escape || char === "q") setWhy(null);
      else if (key.return || char === " ") setWhy({ ...why, expanded: !why.expanded });
      else if (key.upArrow || char === "k")
        // Moving collapses the artifact, so the panel's height stays predictable.
        setWhy({ ...why, cursor: Math.max(0, why.cursor - 1), expanded: false });
      else if (key.downArrow || char === "j")
        setWhy({
          ...why,
          cursor: Math.min(why.decisions.length - 1, why.cursor + 1),
          expanded: false,
        });
      return;
    }
    if (running) {
      // The one live control while a turn runs — everything else stays ignored.
      if (key.escape) handle.interrupt();
      return;
    }
    if (key.backspace || key.delete) {
      setBuffer(inputRef.current.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta) return;

    // Input can arrive as a multi-character chunk (paste, piped input) with
    // the newline inline rather than as a return keypress — treat any newline
    // as submit, joining inner lines visibly with spaces.
    const text = char.replace(/\r\n?/g, "\n");
    const submits = key.return || text.includes("\n");
    const body = text.split("\n").filter(Boolean).join(" ");
    if (submits) {
      const line = (inputRef.current + body).trim();
      setBuffer("");
      if (line) handleLine(line);
    } else if (body) {
      setBuffer(inputRef.current + body);
    }
  });

  return (
    <Box flexDirection="column">
      <Static items={items}>{(item) => <TranscriptLine key={item.id} item={item} />}</Static>
      {running && !pending ? (
        <Box flexDirection="column" marginTop={1}>
          {live ? <Text dimColor>{live}</Text> : null}
          <Text>
            <Spinner />
            <Text dimColor> working… · esc to interrupt</Text>
          </Text>
        </Box>
      ) : null}
      {pending ? <ApprovalOverlay request={pending.request} /> : null}
      {why ? (
        <WhyPanel decisions={why.decisions} cursor={why.cursor} expanded={why.expanded} />
      ) : null}
      {!pending && !running && !why ? (
        <Box marginTop={1}>
          <InputBar value={input} />
        </Box>
      ) : null}
      <StatusBar model={model} sessionId={sessionId} costUsd={sessionCost} />
    </Box>
  );
}
