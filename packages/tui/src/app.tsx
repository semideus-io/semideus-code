import type { ApprovalDecision, EventSink } from "@semideus/core";
import { Box, Static, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalBridge, PendingApproval } from "./approval-bridge";
import { ApprovalOverlay } from "./components/approval-overlay";
import { InputBar } from "./components/input-bar";
import { StatusBar } from "./components/status-bar";
import { TranscriptLine } from "./components/transcript-line";
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
  /** Execute a slash command, returning transcript lines (may be ANSI-colored). */
  command(line: string): Promise<CommandResult>;
}

export interface AppProps {
  handle: TuiHandle;
  approvals: ApprovalBridge;
  banner: { headline: string; lines: string[] };
  model: string;
  sessionId: string;
}

type KeyedItem = TranscriptItem & { id: number };

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 100);
    return () => clearInterval(timer);
  }, []);
  return <Text color="magenta">{SPINNER_FRAMES[frame] ?? "⠋"}</Text>;
}

export function App({ handle, approvals, banner, model, sessionId }: AppProps) {
  const { exit } = useApp();
  const nextId = useRef(1);
  const [items, setItems] = useState<KeyedItem[]>([{ kind: "banner", ...banner, id: 0 }]);
  const [live, setLive] = useState("");
  const liveRef = useRef("");
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [input, setInput] = useState("");
  const [sessionCost, setSessionCost] = useState(0);

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

  const handleLine = useCallback(
    (line: string) => {
      append({ kind: "user", text: line });
      if (line.startsWith("/")) {
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
    [handle, append, exit],
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
    if (running) return;
    if (key.return) {
      const line = input.trim();
      if (!line) return;
      setInput("");
      handleLine(line);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
      return;
    }
    if (char && !key.ctrl && !key.meta) setInput((s) => s + char);
  });

  return (
    <Box flexDirection="column">
      <Static items={items}>{(item) => <TranscriptLine key={item.id} item={item} />}</Static>
      {running && !pending ? (
        <Box flexDirection="column" marginTop={1}>
          {live ? <Text dimColor>{live}</Text> : null}
          <Text>
            <Spinner />
            <Text dimColor> working…</Text>
          </Text>
        </Box>
      ) : null}
      {pending ? <ApprovalOverlay request={pending.request} /> : null}
      {!pending && !running ? (
        <Box marginTop={1}>
          <InputBar value={input} />
        </Box>
      ) : null}
      <StatusBar model={model} sessionId={sessionId} costUsd={sessionCost} />
    </Box>
  );
}
