# Semideus Code

**Train / Learn / Code** — body, knowledge, craft. The third member of the Semideus family: a terminal coding agent whose promise is that *you understand your codebase better after using it than before*.

- **Command:** `demi` — the *semi* half of *semideus*: you are one half, `demi` brings the other.
- **Persona:** **Daimon** — in the lineage of Socrates' daimonion: it advises, warns, and teaches, but never acts in your place. The permission gate enforces that contract in code.
- **Package:** `@semideus/code`

## Status

Phase 0 skeleton: headless agent loop, six tools, non-bypassable permission gate, SQLite sessions, decision log with `/why`, cost tracking, REPL + one-shot mode. TUI, repo map, and the learning layer are next — see [DEVELOPMENT.md](DEVELOPMENT.md).

## Quickstart

```bash
bun install
export ANTHROPIC_API_KEY=sk-ant-…   # or set api_key_env in config
bun demi                             # REPL
bun demi -p "explain the loop in packages/core/src/loop.ts"
```

First run writes a commented config to `~/.config/demi/config.toml` (models, permissions, limits). Local models (Ollama / LM Studio / vLLM) plug in as `openai-compatible` endpoints there.

## CLI surface

```
demi                    interactive REPL
demi -p "task"          one-shot headless run
demi sessions           list stored sessions
demi resume [id]        resume a session (latest if no id)
```

Flags (apply to REPL and one-shot):

| Flag | Short | Description |
| --- | --- | --- |
| `--prompt <text>` | `-p` | run one turn and exit (headless) |
| `--model <id>` | `-m` | model from config (default: `"default"`) |
| `--yes` | | auto-approve all actions — a policy setting that still flows through the permission gate, never around it |
| `--help` | `-h` | print usage |
| `--version` | `-v` | print version |

`demi sessions` lists every stored session (id, last-updated, model, title). `demi resume <id-prefix>` resumes by any unambiguous prefix of the session id; `demi resume` with no id resumes the most recent one.

### REPL commands

Typed at the `you ›` prompt, always prefixed with `/`:

| Command | Effect |
| --- | --- |
| `/help` | list commands |
| `/why [n]` | decision log — every action with its stated rationale and artifacts; `/why 3` shows just step 3 |
| `/cost` | token + cost totals for this session |
| `/undo` | restore files from the last mutating action (uses the pre-mutation snapshot) |
| `/mode [default\|explain]` | show or switch the response mode |
| `/session` | print the current session id and title |
| `/exit`, `/quit` | leave the REPL (also `ctrl-d`) |

Anything not starting with `/` is sent to the agent as a task. When a tool call needs a permission the policy doesn't already grant, you're prompted `[y]es / [a]lways this session / [N]o` — that gate cannot be bypassed by the model.

## Layout

```
packages/
  core/        contracts, agent loop, session, permission gate, SQLite store, decision log
  providers/   config schema + AI SDK adapters (anthropic, openai-compatible)
  tools/       read_file · glob · grep · bash · write_file · edit_file
  learning/    concept ledger (the moat — phase 2)
  tui/         Ink renderer of core events (phase 1)
  cli/         demi entry point: REPL, one-shot, sessions
```

## Docs

- [docs/PLAN.md](docs/PLAN.md) — the full product plan (stack, moat, roadmap)
- [DEVELOPMENT.md](DEVELOPMENT.md) — how this repo is developed: ground rules, phase gates, dogfooding protocol
- [docs/adr/](docs/adr/) — architecture decision records
