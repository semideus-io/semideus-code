import { unlinkSync } from "node:fs";
import type { ModelMessage } from "ai";
import type { AgentEvent, DecisionEvent, EventSink, UsageTotals } from "./contracts/events";
import type { ModelSpec } from "./contracts/provider";
import type { ReplayItem } from "./contracts/replay";
import type { ToolContext } from "./contracts/tool";
import type { PermissionGate } from "./permissions";
import type { ToolRegistry } from "./registry";
import { buildReplay } from "./replay";
import type { SessionStore } from "./store";

export type SessionMode = "default" | "explain";

export interface SessionConfig {
  maxSteps: number;
  mode: SessionMode;
}

const DEFAULT_CONFIG: SessionConfig = { maxSteps: 32, mode: "default" };

/**
 * Cache-token pricing relative to the plain input rate, following Anthropic's
 * shape (ephemeral 5m: writes 1.25×, reads 0.1×). Like everything cost-related
 * these are estimates — config cost_in/cost_out carry the same caveat.
 */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** Warn once when a step's prompt crosses this share of the model's window. */
const CONTEXT_WARN_RATIO = 0.7;

/** What the loop reports per model step — mirrors the AI SDK's usage shape. */
export interface StepUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?:
    | {
        cacheReadTokens?: number | undefined;
        cacheWriteTokens?: number | undefined;
      }
    | undefined;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
}

export interface SessionInit {
  cwd: string;
  model: ModelSpec;
  registry: ToolRegistry;
  gate: PermissionGate;
  store: SessionStore;
  onEvent?: EventSink;
  config?: Partial<SessionConfig>;
  /** Contents of the repo's AGENTS.md, injected into the system prompt. */
  projectMemory?: string;
  /** Rendered repo map (built by cli via @semideus/repomap; core only carries the string). */
  repoMap?: string;
}

export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly model: ModelSpec;
  readonly registry: ToolRegistry;
  readonly gate: PermissionGate;
  readonly store: SessionStore;
  readonly createdAt: number;
  readonly config: SessionConfig;
  projectMemory: string;
  repoMap: string;

  messages: ModelMessage[] = [];
  usage: UsageTotals = emptyUsage();
  /** Usage for the turn in flight — reset by the loop at every turn start. */
  turnUsage: UsageTotals = emptyUsage();

  private readonly onEvent?: EventSink;
  private stepCounter = 0;
  private decisionsCache: DecisionEvent[] = [];
  private contextWarned = false;

  constructor(
    init: SessionInit,
    resume?: { id: string; data: ReturnType<SessionStore["loadSession"]> },
  ) {
    this.id = resume?.id ?? crypto.randomUUID();
    this.cwd = init.cwd;
    this.model = init.model;
    this.registry = init.registry;
    this.gate = init.gate;
    this.store = init.store;
    this.onEvent = init.onEvent;
    this.config = { ...DEFAULT_CONFIG, ...init.config };
    this.projectMemory = init.projectMemory ?? "";
    this.repoMap = init.repoMap ?? "";
    this.createdAt = resume?.data?.createdAt ?? Date.now();
    if (resume?.data) {
      this.messages = resume.data.messages;
      this.usage = resume.data.usage;
      this.config.mode = (resume.data.mode as SessionMode) ?? this.config.mode;
      this.decisionsCache = this.store.decisions(this.id);
      this.stepCounter = this.decisionsCache.at(-1)?.step ?? 0;
    }
  }

  static resume(
    store: SessionStore,
    id: string,
    init: Omit<SessionInit, "store" | "cwd">,
  ): Session {
    const data = store.loadSession(id);
    if (!data) throw new Error(`no session with id ${id}`);
    return new Session({ ...init, store, cwd: data.cwd }, { id, data });
  }

  emit(event: AgentEvent): void {
    this.onEvent?.(event);
  }

  nextStep(): number {
    return ++this.stepCounter;
  }

  logDecision(d: Omit<DecisionEvent, "ts" | "sessionId">): void {
    const event: DecisionEvent = { ...d, ts: Date.now(), sessionId: this.id };
    this.decisionsCache.push(event);
    this.store.logDecision(event);
  }

  decisions(): DecisionEvent[] {
    return this.decisionsCache;
  }

  /** What a resumed session's transcript would have shown, from stored messages. */
  replay(): ReplayItem[] {
    return buildReplay(this.messages, this.registry);
  }

  beginTurn(): void {
    this.turnUsage = emptyUsage();
  }

  trackUsage(u: StepUsage): void {
    const input = u.inputTokens ?? 0;
    const output = u.outputTokens ?? 0;
    const cacheRead = u.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWrite = u.inputTokenDetails?.cacheWriteTokens ?? 0;
    const uncached = Math.max(0, input - cacheRead - cacheWrite);
    const costUsd =
      ((uncached + CACHE_WRITE_MULTIPLIER * cacheWrite + CACHE_READ_MULTIPLIER * cacheRead) *
        this.model.costPerMTok.in +
        output * this.model.costPerMTok.out) /
      1_000_000;
    for (const totals of [this.usage, this.turnUsage]) {
      totals.inputTokens += input;
      totals.outputTokens += output;
      totals.cacheReadTokens += cacheRead;
      totals.cacheWriteTokens += cacheWrite;
      totals.costUsd += costUsd;
    }

    // A step's prompt tokens are the whole history — the live context size.
    const window = this.model.contextWindow;
    if (!this.contextWarned && window > 0 && input >= CONTEXT_WARN_RATIO * window) {
      this.contextWarned = true;
      const pct = Math.round((input / window) * 100);
      this.emit({
        type: "notice",
        text: `context ≈ ${pct}% of the ${Math.round(window / 1000)}k-token window — long sessions degrade and cost more; consider wrapping up (compaction lands in phase 3)`,
      });
    }
  }

  /** Capture a file's pre-mutation state; grouped by step so /undo restores per-action. */
  async snapshot(absPath: string, step: number): Promise<void> {
    const file = Bun.file(absPath);
    const existed = await file.exists();
    const content = existed ? await file.text() : null;
    this.store.saveSnapshot(this.id, step, absPath, existed, content);
  }

  toolContext(step: number): ToolContext {
    return {
      cwd: this.cwd,
      sessionId: this.id,
      step,
      snapshot: (absPath: string) => this.snapshot(absPath, step),
    };
  }

  /** Restore the files touched by the most recent mutating step. Returns restored paths. */
  async undoLast(): Promise<string[]> {
    const step = this.store.latestSnapshotStep(this.id);
    if (step === null) return [];
    const rows = this.store.snapshotsForStep(this.id, step);
    const restored: string[] = [];
    for (const row of rows) {
      if (row.existed && row.content !== null) {
        await Bun.write(row.path, row.content);
      } else {
        try {
          unlinkSync(row.path);
        } catch {
          // already gone — restoring "did not exist" is satisfied
        }
      }
      restored.push(row.path);
    }
    this.store.deleteSnapshotsForStep(this.id, step);
    return restored;
  }

  title(): string {
    const firstUser = this.messages.find((m) => m.role === "user");
    const text =
      typeof firstUser?.content === "string"
        ? firstUser.content
        : (firstUser?.content ?? [])
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(" ");
    return (text || "(empty session)").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  async persist(): Promise<void> {
    this.store.upsertSession({
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      cwd: this.cwd,
      title: this.title(),
      model: this.model.id,
      mode: this.config.mode,
      messages: this.messages,
      usage: this.usage,
    });
  }
}
