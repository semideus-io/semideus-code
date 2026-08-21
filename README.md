# Semideus Code

[![CI](https://github.com/semideus-io/semideus-code/actions/workflows/ci.yml/badge.svg)](https://github.com/semideus-io/semideus-code/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Train / Learn / Code** — body, knowledge, craft. The third member of the Semideus family: a terminal coding agent whose promise is that *you understand your codebase better after using it than before*.

- **Command:** `daimon` — the *semi* half of *semideus*: you are one half, `daimon` brings the other.
- **Persona:** **Daimon** — in the lineage of Socrates' daimonion: it advises, warns, and teaches, but never acts in your place. The permission gate enforces that contract in code.
- **Package:** `@semideus/code`

## Status

**Phase 1 is complete** — the coding agent is real: streaming agent loop, six tools with pre-approval previews, a non-bypassable permission gate, SQLite sessions with resume and replay, pre-mutation snapshots with `/undo`, a decision log with a navigable `/why` panel, tree-sitter repo map, cache-aware cost tracking, weak-model tool fallbacks, and an Ink TUI that renders the diff *before* every approval. **Phase 2 — the learning layer (the moat) — is in progress.** The honest, current snapshot always lives in [docs/STATUS.md](docs/STATUS.md).

## Install

### npm

```bash
npm install -g @semideus/code
```

The package is a thin wrapper: its postinstall downloads the self-contained binary for your platform from the matching GitHub Release and verifies it against a SHA-256 checksum baked in at build time.

### curl

```bash
curl -fsSL https://raw.githubusercontent.com/semideus-io/semideus-code/main/install.sh | sh
```

Installs to `~/.local/bin/daimon` (override with `DAIMON_INSTALL_DIR`; pin a version with `DAIMON_VERSION=0.1.0`). Same checksum verification as the npm route.

### Direct download

Grab `daimon-<os>-<arch>` from the [latest release](https://github.com/semideus-io/semideus-code/releases/latest), verify it against `SHA256SUMS`, `chmod +x`, and put it on your PATH. Supported targets: `linux-x64`, `darwin-arm64`, `darwin-x64`, and `windows-x64` (experimental).

### First run

```bash
export ANTHROPIC_API_KEY=sk-ant-…   # or set api_key_env in config
daimon                              # interactive TUI
daimon -p "explain the loop in packages/core/src/loop.ts"
```

First run writes a commented config to `~/.config/daimon/config.toml` (models, permissions, limits). Local models (Ollama / LM Studio / vLLM) plug in as `openai-compatible` endpoints there — no key required. The `grep` tool wants [ripgrep](https://github.com/BurntSushi/ripgrep) on your PATH; without it, daimon tells you and carries on.

## Run from source

```bash
bun install
bun daimon                             # interactive TUI
bun daimon -p "task"                   # one-shot headless
```

## CLI surface

```
daimon                    interactive TUI
daimon -p "task"          one-shot headless run
daimon sessions           list stored sessions
daimon resume [id]        resume a session (latest if no id)
```

Flags (apply to the TUI and one-shot):

| Flag | Short | Description |
| --- | --- | --- |
| `--prompt <text>` | `-p` | run one turn and exit (headless) |
| `--model <id>` | `-m` | model from config (default: `"default"`) |
| `--yes` | | auto-approve all actions — a policy setting that still flows through the permission gate, never around it |
| `--help` | `-h` | print usage |
| `--version` | `-v` | print version |

`daimon sessions` lists every stored session (id, last-updated, model, title). `daimon resume <id-prefix>` resumes by any unambiguous prefix of the session id; `daimon resume` with no id resumes the most recent one.

### Commands

Typed at the `you ›` prompt, always prefixed with `/`:

| Command | Effect |
| --- | --- |
| `/help` | list commands |
| `/why [n]` | decision log — every action with its stated rationale and artifacts; `/why 3` shows just step 3 |
| `/cost` | token + cost totals for this session |
| `/undo` | restore files from the last mutating action (uses the pre-mutation snapshot) |
| `/mode [default\|explain]` | show or switch the response mode |
| `/permissions [reset]` | show the live permission policy per class; `reset` revokes "always this session" grants |
| `/session` | print the current session id and title |
| `/exit`, `/quit` | leave (also `ctrl-c`) |
| `esc` | interrupt the running turn — partial progress stays in the transcript and session (headless: `ctrl-c` once) |

Anything not starting with `/` is sent to the agent as a task. When a tool call needs a permission the policy doesn't already grant, the approval overlay shows **the change itself** — the unified diff for file edits, the full command for bash — before the `[y]es / [a]lways this session / [N]o` choice (Enter/Esc = no). That gate cannot be bypassed by the model.

## Layout

```
packages/
  core/        contracts, agent loop, session, permission gate, SQLite store, decision log
  providers/   config schema + AI SDK adapters (anthropic, openai-compatible)
  tools/       read_file · glob · grep · bash · write_file · edit_file
  learning/    concept ledger (the moat — phase 2)
  tui/         Ink renderer of core events: transcript, live region, approval overlay
  cli/         daimon entry point: TUI, one-shot, sessions
```

## Docs

- [docs/PLAN.md](docs/PLAN.md) — the full product plan (stack, moat, roadmap)
- [docs/STATUS.md](docs/STATUS.md) — where the product actually is, checked against the code
- [DEVELOPMENT.md](DEVELOPMENT.md) — how this repo is developed: ground rules, phase gates, honesty ledger
- [docs/adr/](docs/adr/) — architecture decision records

## License

[Apache-2.0](LICENSE). The CLI is open; the Semideus Learn server it can bridge to is a separate, closed product ([ADR-0010](docs/adr/0010-distribution-shape-and-license.md)).
