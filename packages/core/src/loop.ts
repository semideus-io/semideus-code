import { generateText, type ToolResultPart } from "ai";
import type { ToolResult } from "./contracts/tool";
import { buildSystemPrompt } from "./prompt";
import type { Session } from "./session";
import { extractRationale, firstLine, truncateMiddle } from "./text";

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

/**
 * The manual agent loop: model → intended tool calls → permission gate →
 * execution → results back to the model, until it answers in prose or the
 * step cap trips. Tools carry no execute functions; this loop is the only
 * place where intent becomes action.
 */
export async function runTurn(s: Session, userMessage: string): Promise<void> {
  s.emit({ type: "turn-start", sessionId: s.id });
  s.messages.push({ role: "user", content: userMessage });

  let concluded = false;
  for (let i = 0; i < s.config.maxSteps; i++) {
    let res: Awaited<ReturnType<typeof generateText>>;
    try {
      res = await generateText({
        model: s.model.model,
        system: buildSystemPrompt(s),
        messages: s.messages,
        tools: s.registry.asAiSdkTools(),
      });
    } catch (err) {
      s.emit({ type: "error", message: `model call failed: ${errorMessage(err)}` });
      break;
    }

    s.trackUsage(res.usage);
    s.messages.push(...res.response.messages);

    const text = res.text.trim();
    if (text) s.emit({ type: "assistant-text", text, final: res.toolCalls.length === 0 });

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
    const calls = (res.toolCalls as ToolCallLike[]).filter((call) => !call.invalid);
    const resultParts: ToolResultPart[] = [];
    for (const call of calls) {
      const step = s.nextStep();
      const { result, denied } = await executeCall(s, call, step, rationale);
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
    }
    if (resultParts.length > 0) {
      s.messages.push({ role: "tool", content: resultParts });
    }
  }

  if (!concluded) {
    s.emit({
      type: "notice",
      text: `turn ended without a conclusion (max ${s.config.maxSteps} steps or model error)`,
    });
  }
  await s.persist();
  s.emit({ type: "turn-end", usage: s.usage });
}

async function executeCall(
  s: Session,
  call: ToolCallLike,
  step: number,
  rationale: string,
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

  const verdict = await s.gate.check(tool, parsed.data, summary);
  let denied = false;
  let result: ToolResult;
  if (!verdict.allowed) {
    const reason = verdict.reason ?? "denied";
    s.emit({ type: "tool-denied", step, tool: tool.name, reason });
    denied = true;
    result = { ok: false, output: `denied: ${reason}` };
  } else {
    try {
      result = await tool.run(parsed.data, s.toolContext(step));
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
  });

  return { result, denied };
}

function refsOf(result: ToolResult): string[] {
  const refs: string[] = [];
  if (result.artifacts?.path) refs.push(result.artifacts.path);
  if (result.artifacts?.command) refs.push(`$ ${result.artifacts.command}`);
  return refs;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
