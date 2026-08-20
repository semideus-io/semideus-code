# ADR-0010 — Distribution shape and license

**Status:** accepted · 2026-08-20

## Context

Phase 3 makes daimon installable by people without this repo. PLAN §14 sketched the
shape; the packaging brief ([../briefs/packaging.md](../briefs/packaging.md)) needs the
decisions fixed: what artifact ships, how the npm story works around six unpublishable
`workspace:*` packages, and under what license — the honesty ledger has required a
license decision before publishing since phase 1.

## Decision

- **Artifact: self-contained binaries** via `bun build --compile`, four targets
  (`linux-x64`, `darwin-arm64`, `darwin-x64`, `windows-x64` — windows experimental),
  cross-compiled from one host by `scripts/build.ts`. The three tree-sitter `.wasm`
  files (the web-tree-sitter runtime + two grammars) are embedded at compile time via
  Bun's `with { type: "file" }` imports — nothing reads `node_modules` at runtime.
- **npm: a generated thin wrapper**, published as `@semideus/code` with bin `daimon`
  (the claude-code/claude pattern). Its postinstall downloads the platform binary for
  its own version and verifies it against SHA-256 checksums baked in at build time.
  No workspace package is ever published; `packages/cli` is `private`.
- **License: Apache-2.0**, whole repo. The CLI being open is the distribution
  flywheel; the moat is the Semideus Learn server, which stays closed. Apache-2.0 over
  MIT for the explicit patent grant — the norm for terminal coding agents (Aider,
  Codex CLI).

## Consequences

- A release's wrapper can only install that release's binaries — supply-chain
  tampering fails the checksum, not the user.
- `DAIMON_BINARY_URL` overrides the download base: offline tests and air-gapped
  installs use the same escape hatch.
- Unsigned binaries will trip macOS Gatekeeper on browser downloads; notarization is
  ledgered, not silently skipped (DEVELOPMENT.md §10).
- The wrapper's `install.js` runs under the user's Node — the one deliberate
  exception to the Bun-only rule, since npm runs postinstall scripts with Node.
