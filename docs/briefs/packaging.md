# Brief: Packaging — compiled binaries + the npm wrapper (phase-3, publish blocker 1)

Make `daimon` runnable by someone who has never heard of this repo, doesn't have Bun, and
never runs `bun install`. PLAN §14 fixed the shape: `bun build --compile` per-platform
binaries plus a thin `@semideus/code` npm wrapper whose postinstall fetches the right
binary (the pattern Codex kept after its rewrite). This brief builds exactly that and
nothing else — the release pipeline that publishes the artifacts is its own brief
([release-pipeline.md](release-pipeline.md)) and consumes this one's outputs. Today
none of it exists: there is no build script anywhere in the monorepo, `packages/cli`'s
`bin` points at raw TypeScript, its six `workspace:*` dependencies resolve nowhere
outside this repo, and there is no LICENSE — which the honesty ledger says must be
decided *before* publishing.

## Constraints (non-negotiable)

- **Zero behavior changes.** This is pure packaging. The agent loop, the permission
  gate, every tool — byte-identical semantics from source and from the binary. The only
  code allowed to change is asset loading and version stamping.
- **The binary is self-contained.** After compile, nothing may read from
  `node_modules` at runtime. The one known breaker: `packages/repomap/src/parser.ts:35`
  resolves `tree-sitter-wasms/out/*.wasm` via `import.meta.resolve` — works from
  source, dead inside a compiled binary. That call site is the choke point; fix it
  there, nowhere else.
- **Graceful degradation is preserved.** `grep` already returns `ok: false` with an
  install hint when `rg` is missing — ripgrep stays an external dependency, documented,
  never bundled. The repo map gets the same standard: if grammar loading fails in any
  environment, daimon warns once and runs without a map. A packaging bug must never crash
  a session.
- **LICENSE lands before the first artifact is built** — closing the honesty-ledger row
  — and the whole distribution shape (license, binary + wrapper pattern, target matrix)
  is recorded as **ADR-0010** before the wiring commit.
- **The npm package ships no workspace code.** The `workspace:*` problem is solved by
  publishing a *generated* thin wrapper, not by publishing seven packages. PLAN §14
  supersedes PLAN §5's older `"bin": "./dist/main.js"` sketch.
- Tests colocated, failure paths mandatory. `bun run verify` green at every step —
  and `bun run smoke` must pass *from the compiled binary*, not just from source.

## Design decisions (already made — don't relitigate)

- **Four targets, from PLAN §14:** `bun-linux-x64`, `bun-darwin-arm64`,
  `bun-darwin-x64`, `bun-windows-x64`. Bun cross-compiles all four from one host, so
  the build runs anywhere. Windows is built but labeled **experimental** in v1 — Ink
  input, `Bun.spawn`, and snapshot paths are unproven there; honesty over coverage.
- **License: Apache-2.0.** The CLI is the flywheel; the moat is the Semideus Learn
  server, which stays closed. Apache-2.0 over MIT for the explicit patent grant — the
  standard choice for dev tools (Aider, Codex CLI). Giannis countersigns this in
  ADR-0010; if he overrides, only the LICENSE file and ADR text change, nothing here.
- **Grammars are embedded at compile time.** *Three* `.wasm` files, not two — the
  web-tree-sitter *runtime* (`tree-sitter.wasm`, loaded by `Parser.init()`) resolves
  from `node_modules` just like the two grammars do (found in implementation; the
  original brief missed it). All three are imported with Bun's `with { type: "file" }`
  loader so `bun build --compile` embeds them; the same imports resolve to real file
  paths in source runs — one code path for both worlds, behind the existing module
  boundary. Tree-sitter types still never leak past `parser.ts`.
- **Version has one source of truth: `packages/cli/package.json`.** The hardcoded
  `const VERSION = "0.0.1"` in `main.ts:29` becomes a build-time `--define` injection
  (source runs read package.json directly). The binary, the wrapper, and `daimon
  --version` cannot drift, because none of them carries its own number.
- **The build is a script: `scripts/build.ts`**, run as `bun run build`. Outputs
  `dist/daimon-<os>-<arch>[.exe]` for all four targets plus `dist/SHA256SUMS`. No flags
  to remember; the release pipeline calls exactly this.
- **The npm wrapper is generated, not maintained.** `bun run build:npm` renders
  `dist/npm/` from a template: package name `@semideus/code`, a `daimon` bin shim that
  execs the platform binary, and a postinstall that downloads
  `daimon-<os>-<arch>` from the GitHub Release matching its own version and **verifies
  it against the SHA-256 baked into the wrapper at build time** — a release's wrapper
  can only ever install that release's binaries. Unsupported platform → clear error
  naming the supported four, exit non-zero. `packages/cli` itself gains
  `"private": true` — it is source, not the product.
- **The download URL is overridable** via `DAIMON_BINARY_URL` (a base URL). That's what
  makes the wrapper testable offline — point it at a local file server in tests — and
  it doubles as the escape hatch for mirrored/air-gapped installs.

## Steps

**1. ADR + LICENSE.** ADR-0010 (license, binary + wrapper shape, four targets, the
embed strategy, the checksum pinning). `LICENSE` at repo root; `license` field added to
every package.json.

**2. Embed the grammars.** Rework `parser.ts` loading: embedded-first,
resolve-fallback. Tests: source-mode fallback still loads both grammars; a simulated
failed load degrades to no-repo-map with a single warning, never a throw (extends the
existing parser tests' failure paths).

**3. The build script.** `scripts/build.ts` → four binaries + checksums, version
injected via `--define`. Tests for the script's pure parts (target list, artifact
naming, checksum format). Proof is behavioral, not unit: step 5.

**4. The wrapper generator.** Template + `build:npm` → `dist/npm/`. Tests: rendered
package.json is valid and version-locked to cli's; postinstall against a local file
server (`DAIMON_BINARY_URL`) fetches, checksum-verifies, and installs; a tampered binary
fails the checksum and exits non-zero leaving nothing on PATH-able ground; an
unsupported platform errors with the supported list.

**5. Prove it end to end, locally.** On the dev machine: `bun run build`, then run
`dist/daimon-darwin-arm64` in a scratch repo **with Bun stripped from PATH and no
node_modules anywhere near it** — full headless task (`-p --yes`), repo map present in
the system prompt (proves the embed), session lands in SQLite, `/undo` restores,
`--version` prints the package.json version. `npm install -g` the packed wrapper with
`DAIMON_BINARY_URL` pointed at `dist/` — `daimon` on PATH runs the same task. `bun run
smoke` green from the binary.

## Done when (verification criteria)

- `bun run verify` green; `bun run smoke` passes when invoked through the compiled
  binary.
- The darwin-arm64 binary completes a real agentic session in a directory with no
  `node_modules` and no `bun` on PATH — repo map included, sessions + snapshots + undo
  working.
- `daimon --version` from the binary matches `packages/cli/package.json` exactly, and no
  second version string exists anywhere in the source tree.
- The wrapper installs via `npm install -g` from a local tarball + local binary server,
  and the tampered-checksum test proves a corrupted download can never install.
- All four target binaries build from one `bun run build` on macOS; linux-x64
  additionally proven by running it in a Linux container.
- LICENSE exists, ADR-0010 merged, the honesty-ledger LICENSE row closed.

## Out of scope (v1)

Publishing anything (the release-pipeline brief) · Homebrew tap and curl installer
(PLAN §14 says "when you're ready" — after the pipeline works) · linux-arm64 ·
macOS notarization / Windows code signing — unsigned binaries will trip Gatekeeper on
browser downloads; npm postinstall and curl mostly dodge it, and signing is ledgered as
a known gap, not silently skipped · auto-update · bundling ripgrep.
