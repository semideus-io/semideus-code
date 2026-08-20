# Brief: MCP client + Semideus Learn bridge (phase-2 gate item, build order 5)

The unfair advantage: daimon becomes an MCP client, and the first server it speaks to is
Semideus Learn. Concepts from the ledger become knowledge cards
(`create_knowledge_cards_tool`); teach-back (`submit_teach_back`) brings server-side
grading — mastery measured, not self-declared. PLAN §10.5. The generic MCP client is
the durable half (any server, any tools, all through the gate); the bridge is the moat
half. Build them in that order.

## Constraints (non-negotiable)

- **MCP tools go through the permission gate. All of them.** A remote tool is a `Tool`
  in the registry with `permission: "network"`, a `summarize()` naming server + tool +
  args, and the standard approval path. There is no "trusted server" bypass; trust is a
  policy the user grants through the gate ("always this session"), never a code path.
- **`@modelcontextprotocol/sdk` lands with this feature** (the ADR-0003 pattern) in a
  new workspace package `packages/mcp` importing core only; `learning` holds the
  Learn-specific bridge logic; `cli` wires both. Record the placement in **ADR-0009**
  (0008 is taken by the recall brief's `ts-fsrs` decision).
- **Config, not code**: `[mcp.servers.<name>]` blocks in `config.toml` (command or URL,
  env), Zod-validated in `providers/src/config.ts` alongside models. Adding a server is
  config, never a code change.
- **Graceful absence, always.** Server not configured → bridge features silently absent.
  Server configured but unreachable → one notice, local ledger and recall untouched.
  A dead server must never break a turn, a digest, or a review.
- **Rationale-is-not-truth applies to deposits**: cards carry the grounded example and
  refs, and the digest-side offer shows exactly what will be sent before the user says
  yes — a deposit is an outward-facing action and is always confirmed.
- Tests colocated, failure paths mandatory. `bun run verify` green at every step.

## Design decisions (already made — don't relitigate)

- **v1 transports: stdio (spawned command) and streamable HTTP** — that covers local
  servers and the hosted Learn server. Connection at session start, lazy where possible.
- **Tool namespacing `mcp__<server>__<tool>`** so remote names can't shadow builtins;
  the registry rejects collisions loudly.
- **Remote schemas are taken as-is** (JSON Schema from the server) and surfaced to the
  model unchanged; daimon validates only that required fields exist before sending.
- **The deposit flow rides `/digest`**: when a Learn server is configured, the digest
  ends with the concept list and "deposit N concepts to Semideus Learn? [y/N]". Yes →
  one `create_knowledge_cards_tool` call through the gate. Concepts remember they've
  been deposited (a `depositedAt` in storage, not in the `Concept` contract) so
  re-digests don't re-offer.
- **Teach-back v1 is a command, not a merge gate**: `/teachback <slug>` prompts for the
  user's explanation, submits via `submit_teach_back`, prints the server's grade and
  feedback. Gating merges on it is explicitly later — the mechanic must earn trust as
  an opt-in first.

## Steps

**1. ADR + config.** ADR-0009; `[mcp.servers.*]` schema + tests (missing fields,
unknown transport → config error messages that say how to fix).

**2. Client core.** `packages/mcp`: connect, list tools, call tool, close — tested
against the SDK's in-memory transport (no live server in CI). Failure tests: connect
refused, call timeout, malformed result → `ToolResult ok: false` with an actionable
message.

**3. Registry + gate integration.** Wrap remote tools as `Tool`s, namespace, register.
Integration test: model calls a remote tool → gate prompts with server+tool summary →
deny works, approve executes, result flows back as a normal tool message.

**4. The bridge.** `learning/src/bridge.ts`: concept → card payload mapping; digest
deposit offer + `depositedAt`; `/teachback`. Tests: payload shape, already-deposited
skip, unreachable-server notice paths.

**5. Prove live.** Against the real Semideus Learn MCP server: deposit concepts from a
real session, confirm the cards exist in Learn; one real teach-back round-trip with the
server's grade rendered. Report what was verified in the commit body. Tick the §7
checkbox.

## Done when (verification criteria)

- `bun run verify` green — including the in-memory-transport suite; smoke green.
- Integration proves: every remote call passes the gate; a denial is honored and
  reported to the model; a namespaced tool can't shadow `read_file`.
- Live: cards created from this repo's ledger are visible in Semideus Learn with
  grounded examples intact; `/teachback` returns a real server grade.
- With the server block removed from config, `/digest`, `daimon review`, and normal turns
  behave exactly as before the feature existed.

## Out of scope (v1)

Teach-back as a merge gate · MCP resources/prompts (tools only) · daimon *as* an MCP
server (PLAN "Later") · auth flows beyond what the SDK transport handles · retry/backoff
sophistication — one attempt, honest failure.
