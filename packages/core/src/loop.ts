import { streamText, type ToolResultPart } from "ai";
import type { DecisionArtifact } from "./contracts/events";
import type { ToolResult } from "./contracts/tool";
import { buildSystemPrompt } from "./prompt";
import type { Session } from "./session";
import { extractRationale, firstLine, truncateMiddle } from "./text";
import {
  fallbackErrorMessage,
  fallbackResultMessage,
  parseFallbackCall,
  toolProtocolPrompt,
} from "./toolmode";

/** Hard cap on what a single tool result feeds back into context. */
const MAX_TOOL_OUTPUT = 48_000;

type ToolCallLike = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  /** v7 marks unparsable/unknown calls invalid and answers them itself in response.messages. */
  invalid?: boolean;
};

interface CallOutcome {
  result: ToolResult;
  denied: boolean;
}

interface StepResult {
  text: string;
  toolCalls: ToolCallLike[];
  /** Fallback modes only: the call block existed but could not be used. */
  parseError?: string;
  /** The user interrupted mid-stream; `text` holds what streamed before the cut. */
  aborted?: boolean;
}

/**
 * One model call, streamed: emits an assistant-delta per text chunk as it
 * arrives, then resolves with the step's final text and tool calls after
 * appending the response messages and tracking usage. streamText never throws
 * up front — failures (including the initial API error) arrive as error parts,
 * which this rethrows so the loop's error handling matches the old
 * generateText behavior: nothing tracked, nothing appended.
 *
 * When `signal` fires, the stream ends with an abort part and every result
 * promise on `result` rejects — so the abort path returns the locally
 * accumulated text and touches none of them. Partial tool calls are dropped:
 * a call the model never finished emitting is never executed.
 *
 * Fallback tool modes (json-fallback / xml-repair) send no native tools:
 * the protocol rides the system prompt, the step's text is parsed for one
 * call block, and the synthesized call flows through the same executeCall —
 * same validation, same permission gate.
 */
async function streamStep(s: Session, signal?: AbortSignal): Promise<StepResult> {
  const native = s.model.toolMode === "native";
  const system = native
    ? buildSystemPrompt(s)
    : `${buildSystemPrompt(s)}\n\n${toolProtocolPrompt(s.registry, s.model.toolMode)}`;
  const result = streamText({
    model: s.model.model,
    system,
    messages: s.messages,
    ...(native ? { tools: s.registry.asAiSdkTools() } : {}),
    abortSignal: signal,
    // The default onError writes to console; errors reach renderers as an
    // AgentEvent instead (the error part below rethrows).
    onError: () => {},
  });

  let streamed = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta" && part.text) {
      streamed += part.text;
      s.emit({ type: "assistant-delta", text: part.text });
    } else if (part.type === "abort") {
      return { text: streamed.trim(), toolCalls: [], aborted: true };
    } else if (part.type === "error") {
      if (signal?.aborted) return { text: streamed.trim(), toolCalls: [], aborted: true };
      throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }

  s.trackUsage(await result.totalUsage);
  if (native) {
    s.messages.push(...(await result.responseMessages));
    return {
      text: (await result.text).trim(),
      toolCalls: (await result.toolCalls) as ToolCallLike[],
    };
  }

  const text = (await result.text).trim();
  if (text) s.messages.push({ role: "assistant", content: text });
  const parsed = parseFallbackCall(text, s.model.toolMode);
  if (parsed.kind === "call") {
    return {
      text: parsed.narration,
      toolCalls: [{ toolCallId: crypto.randomUUID(), toolName: parsed.tool, input: parsed.input }],
    };
  }
  if (parsed.kind === "error") {
    return { text: parsed.narration, toolCalls: [], parseError: parsed.message };
  }
  return { text, toolCalls: [] };
}

/**
 * The manual agent loop: model → intended tool calls → permission gate →
 * execution → results back to the model, until it answers in prose or the
 * step cap trips. Tools carry no execute functions; this loop is the only
 * place where intent becomes action.
 *
 * `opts.signal` interrupts the turn: the in-flight model call or tool run is
 * cut, partial assistant text is kept in the transcript and history, unrun
 * tool calls get an "interrupted" result (so the stored history stays valid
 * for the provider), and the session persists as on any other turn end.
 */
export async function runTurn(
  s: Session,
  userMessage: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const signal = opts?.signal;
  s.beginTurn();
  s.emit({ type: "turn-start", sessionId: s.id });
  s.messages.push({ role: "user", content: userMessage });

  let concluded = false;
  let interrupted = false;
  for (let i = 0; i < s.config.maxSteps; i++) {
    if (signal?.aborted) {
      interrupted = true;
      break;
    }
    let res: StepResult;
    try {
      res = await streamStep(s, signal);
    } catch (err) {
      if (signal?.aborted) {
        interrupted = true;
        break;
      }
      s.emit({ type: "error", message: `model call failed: ${errorMessage(err)}` });
      break;
    }

    if (res.aborted) {
      // Keep what the model already said — visible in the transcript, present
      // in history so a resumed session shows where the cut happened.
      if (res.text) {
        s.messages.push({ role: "assistant", content: res.text });
        s.emit({ type: "assistant-text", text: res.text, final: false });
      }
      interrupted = true;
      break;
    }

    const text = res.text;
    if (text) {
      s.emit({
        type: "assistant-text",
        text,
        final: res.toolCalls.length === 0 && !res.parseError,
      });
    }

    if (res.parseError) {
      // The fallback repair round-trip: name the damage, spend a step on it.
      s.emit({
        type: "notice",
        text: `tool call unusable (${res.parseError}) — asked the model to re-emit`,
      });
      s.messages.push({ role: "user", content: fallbackErrorMessage(res.parseError) });
      continue;
    }

    if (res.toolCalls.length === 0) {
      s.logDecision({
        step: s.nextStep(),
        kind: "conclusion",
        summary: firstLine(text) || "(finished without text)",
        rationale: "",
        refs: [],
      });
      concluded = true;
      break;
    }

    const rationale = extractRationale(text);
    // Invalid calls (unknown tool, unparsable input) already carry an SDK-generated
    // error result in response.messages — answering them again would duplicate the
    // toolCallId and break the provider API.
    const native = s.model.toolMode === "native";
    const calls = res.toolCalls.filter((call) => !call.invalid);
    const resultParts: ToolResultPart[] = [];
    const fallbackResults: string[] = [];
    for (const call of calls) {
      // Interrupted mid-batch: unrun calls still need a result — a native
      // history with a tool-use and no tool-result is rejected by providers.
      if (signal?.aborted) {
        interrupted = true;
        if (native) {
          resultParts.push({
            type: "tool-result",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: "execution-denied", reason: "turn interrupted before this call ran" },
          });
        } else {
          fallbackResults.push(
            fallbackResultMessage(call.toolName, false, "not executed — turn interrupted", true),
          );
        }
        continue;
      }
      const step = s.nextStep();
      const { result, denied } = await executeCall(s, call, step, rationale, signal);
      if (native) {
        resultParts.push({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: denied
            ? { type: "execution-denied", reason: result.output }
            : {
                type: result.ok ? "text" : "error-text",
                value: truncateMiddle(result.output, MAX_TOOL_OUTPUT),
              },
        });
      } else {
        fallbackResults.push(
          fallbackResultMessage(
            call.toolName,
            result.ok,
            truncateMiddle(result.output, MAX_TOOL_OUTPUT),
            denied,
          ),
        );
      }
    }
    if (resultParts.length > 0) {
      s.messages.push({ role: "tool", content: resultParts });
    }
    if (fallbackResults.length > 0) {
      s.messages.push({ role: "user", content: fallbackResults.join("\n") });
    }
    if (interrupted) break;
  }

  if (interrupted) {
    s.emit({ type: "notice", text: "turn interrupted — partial progress kept, session saved" });
  } else if (!concluded) {
    s.emit({
      type: "notice",
      text: `turn ended without a conclusion (max ${s.config.maxSteps} steps or model error)`,
    });
  }
  await s.persist();
  s.emit({ type: "turn-end", turn: s.turnUsage, session: s.usage });
}

async function executeCall(
  s: Session,
  call: ToolCallLike,
  step: number,
  rationale: string,
  signal?: AbortSignal,
): Promise<CallOutcome> {
  const tool = s.registry.get(call.toolName);
  if (!tool) {
    return { result: { ok: false, output: `unknown tool: ${call.toolName}` }, denied: false };
  }

  const parsed = tool.schema.safeParse(call.input);
  if (!parsed.success) {
    return {
      denied: false,
      result: {
        ok: false,
        output: `invalid input for ${call.toolName}: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
      },
    };
  }

  const summary = tool.summarize(parsed.data);
  s.emit({ type: "tool-start", step, tool: tool.name, summary, permission: tool.permission });

  const preview = tool.preview?.bind(tool);
  const verdict = await s.gate.check(tool, parsed.data, summary, {
    preview: preview && (() => preview(parsed.data, s.toolContext(step))),
  });
  let denied = false;
  let result: ToolResult;
  if (!verdict.allowed) {
    const reason = verdict.reason ?? "denied";
    s.emit({ type: "tool-denied", step, tool: tool.name, reason });
    denied = true;
    result = { ok: false, output: `denied: ${reason}` };
  } else {
    try {
      result = await tool.run(parsed.data, s.toolContext(step, signal));
    } catch (err) {
      result = { ok: false, output: `${tool.name} crashed: ${errorMessage(err)}` };
    }
    s.emit({
      type: "tool-end",
      step,
      tool: tool.name,
      ok: result.ok,
      output: result.output,
      permission: tool.permission,
      artifacts: result.artifacts,
    });
  }

  s.logDecision({
    step,
    kind: tool.name === "write_file" || tool.name === "edit_file" ? "edit" : "tool_call",
    summary,
    rationale,
    refs: refsOf(result),
    artifact: artifactOf(result),
  });

  return { result, denied };
}

function refsOf(result: ToolResult): string[] {
  const refs: string[] = [];
  if (result.artifacts?.path) refs.push(result.artifacts.path);
  if (result.artifacts?.command) refs.push(`$ ${result.artifacts.command}`);
  return refs;
}

/** Per-artifact cap. Generous enough to read a real diff, small enough that a
 *  session's decision log stays a log — bash output is the usual offender. */
const MAX_ARTIFACT_CHARS = 4000;

/**
 * The checkable evidence for a step. Edits carry their diff; commands carry
 * what they printed (success included — "the tests passed" is a claim, the
 * output is the artifact). Read-class calls get nothing: the file isn't
 * evidence of a decision, and storing every read would bloat the log.
 */
function artifactOf(result: ToolResult): DecisionArtifact | undefined {
  const artifact: DecisionArtifact = {};
  if (result.artifacts?.diff) {
    artifact.diff = truncateMiddle(result.artifacts.diff, MAX_ARTIFACT_CHARS);
  }
  if (result.artifacts?.command && result.output.trim()) {
    artifact.output = truncateMiddle(result.output.trim(), MAX_ARTIFACT_CHARS);
  }
  return artifact.diff || artifact.output ? artifact : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
