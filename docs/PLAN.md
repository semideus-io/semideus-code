# Semideus Code — Getting Started

**Product:** Semideus Code, the third member of the Semideus family — Train / Learn / **Code**: body, knowledge, craft. **Command:** `daimon` — the *semi* half of *semideus*: you are one half, `daimon` brings the other. **Persona:** Daimon — the flame from Semideus Learn, now the voice in your terminal; in the lineage of Socrates' daimonion, it advises, warns, and teaches, but never acts in your place. **Package:** `@semideus/code`.

---

## 0. The decision in one paragraph

Build the whole tool in **TypeScript, running on Bun**, with **Ink** for the TUI, the **Vercel AI SDK wrapped behind your own thin provider interface** for cloud + local models, **Zod** for tool schemas, **`bun:sqlite`** for sessions and the learning ledger, **`web-tree-sitter`** for the repo map, and the **official MCP TypeScript SDK** for extensibility — including a first-party connection to your own Semideus Learn MCP server, which is the single biggest unfair advantage you have. Ship a headless agent loop in week 1, a usable TUI daily-driver by week 4, and the learning layer (your moat) by week 8.

---

## 1. Final stack

| Layer | Choice | Fallback / later |
|---|---|---|
| Language | TypeScript (strict) | — |
| Runtime | Bun ≥ 1.1 | Node 20+ compat kept in mind |
| TUI | Ink (React for terminals) | OpenTUI if Ink's frame cap ever bites |
| Model layer | Vercel AI SDK behind a custom `Provider` interface | Hand-rolled adapters if the SDK constrains you |
| Local models | Ollama / LM Studio / vLLM via OpenAI-compatible endpoints | Tool-call fallback tiers (JSON mode → XML+repair) |
| Schemas & config | Zod + TOML (`~/.config/daimon/config.toml`) | — |
| Storage | `bun:sqlite` (sessions, decisions, concepts) | libsql if you ever want sync |
| Repo map | `web-tree-sitter` (WASM) + PageRank | Embeddings-based search later |
| Extensibility | MCP client (`@modelcontextprotocol/sdk`) | Expose daimon itself as an MCP server later |
| Process/exec | `Bun.spawn` / `execa`, `rg` for search | — |
| Lint/format/test | Biome + `bun test` | vitest if you outgrow it |
| Distribution | `bun build --compile` per-platform binaries + thin npm wrapper | — |

## 2. Why this stack, and why it's the future-proof pick

**The security-moat reasons for Rust died with the security moat.** The strongest arguments for a Rust core were native sandboxing primitives (seccomp, Landlock, Seatbelt bindings) and defense-grade memory behavior — that's what OpenAI bought with the Codex rewrite. You just moved security to a separate future project. What remains decision-relevant is iteration speed on UX, model fluency, and ecosystem gravity — all of which point at TypeScript.

**Models write TypeScript better than anything else, and your tool will largely write itself.** Anthropic has said roughly 90% of Claude Code is written with Claude Code, and picking an "on-distribution" stack was a deliberate choice. For a solo builder, the compounding effect of the agent being maximally fluent in its own codebase is worth more than raw runtime performance.

**Bun removes the classic Node objections.** Fast startup, built-in SQLite and test runner, native TypeScript execution, and `bun build --compile` producing a single self-contained binary per platform. You get most of Rust's distribution story (one file, no runtime install) without Rust's iteration tax.

**The extension ecosystem is TypeScript-first.** The MCP reference SDK is TS. Ink is what Claude Code and Gemini CLI ship on at enormous scale. The AI SDK gives you Anthropic, OpenAI, Google, OpenRouter, and any OpenAI-compatible local endpoint behind one interface.

**It fits your world.** Your research and fine-tuning life (apeiron, offline RL, adversarial work) stays in Python where it belongs — the CLI consumes models through APIs and local endpoints regardless of what language trained them. Your product life (Semideus Learn) is already web/TypeScript. One brain, two languages, clean split: **Python for research, TypeScript for product.**

**The escape hatch is real.** Keep the provider, tool, permission, and storage boundaries as clean interfaces. If a hot path ever genuinely needs native speed, port that one module to Rust via napi-rs — the exact migration path Codex took — without touching the rest.

## 3. Why the learning moat is the right call (and how to make it defensible)

The security-agent space is crowded and heavily funded (XBOW, RunSybil, Big Sleep, a dozen startups per quarter). The learning space is nearly empty: every major tool optimizes for *the human doing less*, and the deskilling anxiety is real, measurable, and growing. Nobody has shipped a coding agent whose core promise is *you will understand your codebase better after using this than before*.

Your structural advantage: **you already own a spaced-repetition, teach-back, wiki-graph backend with an MCP server.** The moat is not "explanations in the terminal" — anyone can prompt for that. The moat is the **closed learning loop**: concepts encountered while coding → captured → scheduled for review → tested via teach-back → measured over weeks. That requires learning infrastructure competitors would have to build from scratch. Design daimon so the loop also works standalone (built-in FSRS scheduler) but is *supercharged* when connected to Semideus Learn — that's both a moat and a distribution flywheel between your two products.

The honest framing that will earn trust: models' stated rationales are not guaranteed faithful accounts of their computation (you know this literature better than anyone). So the learning layer never presents rationale as ground truth — every "why" is anchored to observable artifacts: the diff, the command, the test output. Explanations are the agent's account *of verifiable actions*, and comprehension is measured on the human, not asserted by the model. That epistemic honesty is itself a differentiator.

## 4. Architecture overview

```
┌─────────────────────────── TUI (Ink) ───────────────────────────┐
│  transcript · streaming · diff viewer · approval prompts ·       │
│  plan preview · /why panel · session digest                      │
└───────────────▲──────────────────────────────▲──────────────────┘
                │ events                        │ input
┌───────────────┴────────────── core ──────────┴──────────────────┐
│  agent loop · session store · permission gate · checkpoints      │
│  decision log ─────────────► learning layer                      │
│                              (concept ledger · recall · modes ·  │
│                               teach-back gates · Semideus bridge)│
└───────▲──────────────────▲──────────────────▲────────────────────┘
        │                  │                  │
   providers            tools              MCP client
 (AI SDK wrapped)  (fs·edit·bash·grep·   (Semideus Learn,
  cloud + local     glob·repo-map)        anything else)
```

Everything communicates through typed events. The TUI is a renderer of core events, never the owner of state — this keeps headless/CI mode trivial and lets you swap Ink for OpenTUI later without touching logic.

## 5. Scaffold

```bash
mkdir semideus-code && cd semideus-code && bun init -y
mkdir -p packages/{core,providers,tools,learning,tui,cli}
```

`package.json` (root):

```json
{
  "name": "semideus-code",
  "private": true,
  "workspaces": ["packages/*"]
}
```

Dependencies (add per-package as needed):

```bash
bun add ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/openai-compatible \
        zod ink react execa fast-glob diff @modelcontextprotocol/sdk
bun add -d typescript @types/react @types/diff @biomejs/biome
```

Directory intent:

```
packages/
  core/        agent loop, session, events, permissions, checkpoints, decision log
  providers/   Provider interface + AI SDK adapters + local fallback tiers
  tools/       read, write, edit(+diff), bash, grep, glob, repo-map
  learning/    modes, concept ledger, recall scheduler, semideus bridge, telemetry
  tui/         Ink app (pure renderer of core events)
  cli/         entry point, config loading, headless mode
```

The one publishable package is `packages/cli`, named `@semideus/code` and exposing `"bin": { "daimon": "./dist/main.js" }`; the rest stay private workspace packages.

> API surfaces below are schematic and written against AI SDK v5-era APIs. Ink and the AI SDK move fast — verify exact names against current docs when you scaffold.

## 6. Core contracts

```ts
// packages/providers/src/provider.ts
import type { LanguageModel } from "ai";

export interface ModelSpec {
  id: string;                      // "default", "local", "cheap"
  model: LanguageModel;            // AI SDK model instance
  contextWindow: number;
  toolMode: "native" | "json-fallback" | "xml-repair";
  costPerMTok: { in: number; out: number };
}
```

```ts
// packages/tools/src/tool.ts
import { z } from "zod";

export type PermissionClass = "read" | "write" | "execute" | "network";

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;             // written for the model
  schema: S;
  permission: PermissionClass;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolResult {
  ok: boolean;
  output: string;                  // what the model sees
  artifacts?: { path?: string; diff?: string; command?: string };
}
```

```ts
// packages/core/src/events.ts — the glass-box spine of the whole product
export type DecisionEvent = {
  ts: number;
  sessionId: string;
  step: number;
  kind: "plan" | "tool_call" | "edit" | "conclusion";
  summary: string;                 // what happened, one line
  rationale: string;               // the model's stated why (1–2 sentences)
  alternatives?: string[];         // options it says it considered
  refs: string[];                  // files touched, commands run, diff ids
};
```

`DecisionEvent` is not a logging afterthought — it is the substrate the entire learning layer reads from. Get it right in week 1.

## 7. The agent loop

Manual loop, tools without auto-execute, permission gate between the model's intent and the world:

```ts
// packages/core/src/loop.ts (schematic)
import { generateText } from "ai";

export async function runTurn(s: Session, userMsg: string) {
  s.messages.push({ role: "user", content: userMsg });

  for (let step = 0; step < s.config.maxSteps; step++) {
    const res = await generateText({
      model: s.model.model,
      system: buildSystemPrompt(s),        // mode, AGENTS.md, repo map budget
      messages: s.messages,
      tools: registry.asAiSdkTools(),      // schemas only — no execute fns
    });

    s.messages.push(...res.response.messages);
    emit(s, textEvents(res));

    if (res.toolCalls.length === 0) break; // model finished with prose

    for (const call of res.toolCalls) {
      const tool = registry.get(call.toolName);
      const verdict = await s.permissions.check(tool, call.args); // may prompt user
      const result = verdict.allowed
        ? await tool.run(call.args, s.ctx)
        : { ok: false, output: `denied: ${verdict.reason}` };

      s.decisions.log({
        kind: "tool_call",
        summary: describe(call),
        rationale: extractRationale(res, call),  // from the model's own text
        refs: result.artifacts ? refsOf(result.artifacts) : [],
        ts: Date.now(), sessionId: s.id, step,
      });

      s.messages.push(toolResultMessage(call, result));
    }
  }
  await s.persist();
}
```

Rules that keep you sane: max-steps cap always on; every mutating tool (`write`, `edit`, `bash`) snapshots before running (§12); the permission gate is non-bypassable even in your own dogfooding — auto-accept is a *setting*, not a code path around the gate.

## 8. Tools v1

Ship exactly six, in this order: `read_file`, `glob`, `grep` (shell out to `rg`), `bash`, `write_file`, `edit_file`. The edit tool is the one worth craftsmanship — use string-replacement edits (old text must match uniquely) rather than line numbers, return a unified diff in `artifacts.diff`, and render it in the TUI for approval. This single tool determines half of how trustworthy the product feels.

The repo map comes right after: parse with `web-tree-sitter` (WASM grammars, no native build pain in Bun), build a definition/reference graph, rank with personalized PageRank, render the top slice within a ~1k-token budget into the system prompt. This is Aider's proven design — it processes billions of tokens weekly on it — and it's the highest-leverage context feature you can build. Cache the graph in `.daimon/cache/` keyed by file mtimes.

## 9. Providers: cloud + local, first-class both

Config, not code:

```toml
# ~/.config/daimon/config.toml
[models.default]
provider = "anthropic"
model    = "claude-sonnet-4-6"

[models.cheap]                      # used for concept extraction, summaries
provider = "anthropic"
model    = "claude-haiku-4-5"

[models.local]
provider  = "openai-compatible"
base_url  = "http://localhost:11434/v1"   # Ollama; LM Studio/vLLM identical
model     = "qwen3-coder:30b"
tool_mode = "json-fallback"
```

Adapter construction is a few lines with the AI SDK (`createAnthropic`, `createOpenAICompatible`). The part that earns its keep is the **tool-mode tier**: `native` passes tools through; `json-fallback` instructs the model to answer with a JSON tool-call object and validates with Zod; `xml-repair` wraps calls in XML tags, parses leniently, and runs one repair round-trip on failure. Weak local models become genuinely usable with tiers 2–3, and this is precisely where most competitors are sloppy.

Route by task, not loyalty: `default` for the loop, `cheap` for the learning layer's extraction passes (§10), `local` for offline work and privacy-sensitive repos. Track tokens and cost per session from day one — it's a two-hour feature that users never forgive the absence of.

## 10. The learning layer — your moat

Six features, buildable in this order. Everything reads from `DecisionEvent` and the diffs.

All of it speaks with one voice: **Daimon**. Implement the persona as a thin system-prompt overlay plus TUI identity — the header, the spinner, the narrator of `/why` and the session digest. It isn't decoration; it encodes the product's contract in the Socratic register: a daimonion advises and warns but never acts in your place, which is precisely what the permission gate enforces in code. One character across Learn and Code gives the family a shared face — and gives your Daemon Zero channel something concrete to embody.

### 10.1 Glass-box `/why`
Every tool call and edit already logs summary + rationale + refs. `/why` opens a navigable panel: step-by-step account of the session, each entry linked to its artifact (diff, command output). `/why 14` explains step 14 specifically. Always render the disclaimer once per session: *rationales are the model's account, anchored to the artifacts shown*.

### 10.2 Plan-first mode
Before mutating anything, the agent produces a numbered plan with a one-line rationale per step; user approves, edits, or rejects. Cheap to build (one system-prompt state + one approval UI), disproportionately trust-building.

### 10.3 Output modes: `default` / `explain` / `mentor`
Modes are system-prompt overlays plus small loop behaviors. `explain` interleaves short teaching notes on trade-offs ("chose a Map over an object here because…"). `mentor` is the deep one: the agent scaffolds the change but leaves 5–15 deliberate `// TODO(you): …` gaps at decision points, pauses, waits for the user's edit, then reviews the user's diff like a senior engineer — approving, correcting, and explaining. Mode switching via `/mode mentor` or per-task flag.

### 10.4 Concept ledger + session digest
After each turn, a `cheap`-model pass over the diff and transcript extracts concepts:

```ts
type Concept = {
  slug: string; name: string;
  kind: "api" | "pattern" | "pitfall" | "domain";
  example: string;                 // grounded in this session's actual code
  firstSeen: number; occurrences: number;
};
```

Stored in SQLite. On `/digest` or session end: "Today you touched: async generators (3×), Zod refinements (new), N+1 query pitfall (new)…" with jump-links to the code where each appeared. The examples being *from the user's own codebase* is what makes this pedagogically strong.

### 10.5 Recall loop — the Semideus bridge
Built-in: an FSRS scheduler (via `ts-fsrs`, target retention 0.9) over the concept ledger; `daimon review` runs a 3-minute terminal review of due concepts. Connected: when the Semideus Learn MCP server is configured, the digest offers "deposit to Semideus?" — concepts become knowledge cards via `create_knowledge_cards_tool`, and big merges can gate on a Feynman check via `submit_teach_back` (your server-side grading, not self-declared mastery). This closes the loop with infrastructure only you have: encode while coding, retrieve on schedule, consolidate through teach-back — the same encoding→retrieval→consolidation cycle you teach in computational neuroscience, which is exactly the "neural" in your neural coding agent.

### 10.6 `/onboard` + comprehension telemetry
`/onboard` walks a new codebase: repo map tour, architecture narrative, the five files that matter, generates `FOR-YOU.md`. Telemetry: store teach-back grades and review outcomes over time and chart them — *measured* understanding is your empirical answer to the deskilling debate (the famous METR slowdown result was later walked back by its own authors; the honest position is to measure, and you'll be one of the only tools that can).

## 11. TUI with Ink

Structure: a `Static` component for the finished transcript (Ink doesn't re-render Static children — this sidesteps most performance issues), a live region for the streaming turn, and modal overlays for approvals, plan preview, diff view, and `/why`. Throttle stream renders to ~30–60ms batches. Keep every keybinding also available as a slash command so headless and TUI stay feature-equivalent. If you ever hit Ink's ceiling (very long sessions, heavy streaming), OpenTUI is the designated exit — but Claude Code ships on Ink at massive scale, so don't pre-optimize.

## 12. Sessions, memory, checkpoints

Sessions are SQLite rows (messages, events, concepts) in `~/.local/share/daimon/`; `daimon --resume` lists and restores. Project memory is a plain `AGENTS.md` at repo root (the emerging cross-tool standard — adopt it rather than inventing your own file). Checkpoints v1: before any mutating tool, copy touched files into the session store; `/undo` restores. Checkpoints v2 (phase 3): a shadow git repo (separate `GIT_DIR`, same worktree) committing every step — Cline-style time travel without polluting the user's history. Context compaction: when the window passes ~70%, summarize the oldest turns with `cheap`, keep the repo map and current task verbatim, and *re-inject `AGENTS.md` after every compaction* — the classic bug is losing project instructions mid-session.

## 13. Evals: prove the moat

Three tracks, small and owned by you. **Capability**: ~20 held-out terminal tasks in the Terminal-Bench style, pass/fail, run headless in CI — enough to catch regressions without chasing leaderboards. **Learning outcome**: the differentiating one — after matched tasks in `default` vs `mentor` mode, a short comprehension quiz on the changed code; the metric is the comprehension delta at comparable task success. **Retention**: for Semideus-connected users, review success on coding-derived cards at 7/30 days. Even n=10 pilot numbers here become your launch story, because no competitor publishes anything like them.

## 14. Distribution

```bash
bun build --compile --target=bun-linux-x64  ./packages/cli/src/main.ts --outfile dist/daimon-linux-x64
bun build --compile --target=bun-darwin-arm64 ./packages/cli/src/main.ts --outfile dist/daimon-darwin-arm64
# + darwin-x64, windows-x64
```

Publish `@semideus/code` — the thin npm package exposing the `daimon` bin — whose postinstall fetches the right platform binary (the pattern Codex kept after its rewrite), plus a curl installer and a Homebrew tap when you're ready.

## 15. Roadmap

| Phase | Weeks | Ships |
|---|---|---|
| 0 — Skeleton | 1 | Headless loop, 6 tools, permission gate, Anthropic + one local model, `daimon -p "…"` one-shot + REPL |
| 1 — Daily driver | 2–4 | Ink TUI (streaming, diff approval), sessions + resume, repo map, cost tracking, `AGENTS.md`, checkpoints v1 |
| 2 — The moat | 5–8 | Decision log + `/why`, plan-first, explain/mentor modes, concept ledger + digest, built-in recall, MCP client + Semideus bridge, `/onboard` |
| 3 — Hardening | 9–12 | Compaction, shadow-git checkpoints, subagent task tool, headless CI mode, eval harness (all three tracks), compiled binaries + npm wrapper |
| Later | — | Semideus Code as an MCP server, OpenTUI migration if needed, Rust hot-path if ever justified, team features |

Gate each phase on dogfooding: you should be using phase N daily before starting N+1. Use daimon to build Semideus Code itself from phase 1 onward — with a TS stack, that compounding is the whole point.

## 16. Pitfalls, honestly

Don't build the TUI first; the loop is the product and a REPL proves it. Don't over-abstract providers on day one — two adapters behind one interface is enough. Don't let mentor mode become homework: gaps must be *decision points*, never boilerplate, or users will flee to auto-complete tools. Don't present model rationale as introspective truth — anchor to artifacts, always. And don't skip the permission gate while dogfooding solo; the habit you build is the product you ship.

## 17. Codebases to study (not fork)

**Aider** for the repo map and edit formats; **sst/opencode** for a TypeScript-core agent architecture and TUI event design; **Codex CLI** for loop/session structure and the binary-distribution pattern; **Cline** for checkpoint UX and plan/act approval flow; **pi-mono** for how small a good harness can be (lazy skills, ~1k-token system prompt); **Anthropic's claude-code repo** (plugins, output styles — the Learning output style is the closest existing thing to mentor mode, and your reference point to beat).
