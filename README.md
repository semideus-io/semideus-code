# Semideus Code

[![CI](https://github.com/semideus-io/semideus-code/actions/workflows/ci.yml/badge.svg)](https://github.com/semideus-io/semideus-code/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A terminal coding agent, `daimon`, built around one idea: **you should understand your codebase better after using it, not worse.**

## The problem

AI agents now write a lot of your code. The code ships — your understanding doesn't. Every generated diff you approve without really reading it is **cognitive debt**: you end up owning a codebase you no longer know. It works until the day you have to debug it, extend it, or explain it.

## The solution

`daimon` writes code with you, not instead of you:

- **Nothing happens without you.** Every file edit shows its full diff and every shell command shows itself *before* you approve it. The permission gate is enforced in code and the model cannot bypass it.
- **Every action is explainable.** `/why` shows the decision log: what was done and why, anchored to real artifacts — diffs and command output, not the model's say-so.
- **Every change is reversible.** Files are snapshotted before they're touched; `/undo` restores them.
- **Understanding is the roadmap.** In progress: a learning layer that turns what the agent did in your repo into concepts you actually review and retain — paying the debt down instead of up.

Works with Claude or any local model (Ollama / LM Studio / vLLM). The agent is fully working today; the learning layer is being built — the honest, current state always lives in [docs/STATUS.md](docs/STATUS.md).

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
  learning/    concept ledger (in progress)
  tui/         Ink renderer of core events: transcript, live region, approval overlay
  cli/         daimon entry point: TUI, one-shot, sessions
```

## Docs

- [docs/PLAN.md](docs/PLAN.md) — the full product plan
- [docs/STATUS.md](docs/STATUS.md) — where the product actually is, checked against the code
- [DEVELOPMENT.md](DEVELOPMENT.md) — how this repo is developed: ground rules, phase gates, honesty ledger
- [docs/adr/](docs/adr/) — architecture decision records

## License

[Apache-2.0](LICENSE) — see [ADR-0010](docs/adr/0010-distribution-shape-and-license.md).
