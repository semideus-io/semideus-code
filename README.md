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
