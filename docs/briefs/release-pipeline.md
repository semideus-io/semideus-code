# Brief: Release pipeline — remote, tagged releases, publish CI (phase-3, publish blocker 2)

Make releasing a mechanical act: push a tag, and CI builds the matrix from
[packaging.md](packaging.md), attaches binaries + checksums to a GitHub Release, and
publishes the `@semideus/code` wrapper to npm — all from green, or not at all. Today
there is nothing to mechanize *on*: `git remote -v` is empty (the repo exists only on
this machine), CI has a verify job and no release job, and the README still says
"Phase 1 in progress" — stale since 2026-07-23. This brief takes the repo public and
wires the path from tag to installable product. It strictly depends on the packaging
brief: every artifact it publishes is produced by `bun run build` / `bun run
build:npm`; this brief adds no build logic of its own.

## Constraints (non-negotiable)

- **Going public is a one-way door — hygiene first.** Before the first push: a
  secret scan over the *entire git history* (not just HEAD), and a docs truth pass
  (README status section, STATUS.md's stale "162 tests" count). Nothing ships with a
  key in its history or a lie on its front page.
- **Publish only from green, atomically.** The release job re-runs the full verify
  suite plus the keyless binary checks; the GitHub Release is created only after *all
  four* binaries build and check out, and npm publish runs only after the Release
  exists (the postinstall downloads from it — publish order is a correctness
  constraint, not a style choice). A failed tag publishes nothing, ever.
- **No long-lived secrets in CI.** npm publish uses OIDC trusted publishing with
  `--provenance`; there is no `NPM_TOKEN` to leak. GitHub Release upload uses the
  workflow's own `GITHUB_TOKEN`.
- **`bun run smoke` stays out of CI** — the standing rule holds. CI's binary
  verification is keyless: `--version`, `--help`, `daimon sessions` (runs without a key),
  and the grep tool's no-`rg` failure path. The full agentic smoke from the compiled
  binary is a *local, pre-tag* gate, checklisted in DEVELOPMENT.md.
- **Tag and version cannot drift.** The release job fails fast if the tag
  (`vX.Y.Z`) doesn't equal `packages/cli/package.json`'s version. One number, enforced.
- Tests colocated where there's code to test (the version-match check, the release
  checklist script). `bun run verify` green at every step.

## Design decisions (already made — don't relitigate)

- **Remote: `github.com/<owner>/semideus-code`, public.** Giannis creates the repo and
  picks the owner (personal vs a Semideus org — his call, made at step 1, changes only
  the URL). Public is required anyway for npm provenance attestation, and the CLI being
  open *is* the flywheel (ADR-0010's license logic).
- **Trigger: pushed tags matching `v*`,** in a separate `release.yml` — `ci.yml` stays
  exactly the verify job it is. Releasing is deliberate; nothing releases from a branch
  push.
- **One builder, three checkers.** Bun cross-compiles all four targets, so a single
  ubuntu runner runs `bun run build` once. Then per-OS jobs (ubuntu, macos, windows
  runners) download their artifact and run the keyless checks on real hardware —
  windows continues to be labeled experimental and its check job is `continue-on-error`
  in v1, honestly mirroring the packaging brief's stance.
- **Versioning: semver, starting `v0.1.0`, staying 0.x until the phase-2 moat ships.**
  Publishing a 0.x coding agent while the learning layer is still landing is honest —
  claiming 1.0 without the moat would be marketing the plan intends to avoid.
- **Cutting a release is a script, not a memory:** `bun run release` bumps
  `packages/cli/package.json`, runs the local gate (verify + compiled-binary smoke),
  commits, tags, and prints the push command. It never pushes by itself — the human
  pushes the tag. The tag-version match check lives in both the script and the
  workflow.
- **The README refresh is part of this brief,** not a someday: install instructions
  (npm + direct binary download), the real status (phase 1 closed, phase 2 in
  progress), the license badge. The instructions are written by copy-pasting them into
  a clean machine/container and watching them work — install docs that were never run
  are fiction.
- **Branch protection: main requires the CI verify job.** Cheap insurance even solo;
  the pre-commit hook already runs the same gate locally, so this changes nothing about
  the daily loop.

## Steps

**1. Hygiene + remote.** Full-history secret scan (gitleaks over `--log-opts=--all`);
fix README + STATUS staleness; commit the six phase-2 briefs currently sitting
untracked; create the GitHub repo, push, confirm `ci.yml` goes green on GitHub's
runners (it installs ripgrep already — first run on foreign hardware is itself a
check). Turn on branch protection.

**2. `release.yml`.** Tag trigger → version-match guard → verify → single-runner
`bun run build` → per-OS keyless check jobs → GitHub Release (binaries + `SHA256SUMS`,
release notes from the tag annotation) → then, and only then, the npm job.

**3. npm publish job.** `bun run build:npm` → `npm publish --provenance --access
public` via OIDC trusted publishing (configured on npmjs.com for the repo — one-time
setup, documented in DEVELOPMENT.md). The wrapper it publishes is checksum-pinned to
the binaries the *same workflow run* just attached.

**4. The release script.** `bun run release` as decided above, plus its
DEVELOPMENT.md section: the pre-tag checklist (verify, compiled-binary smoke, docs
current) and the one command to cut a version.

**5. Cut `v0.1.0` for real.** Run the whole path: script → tag → CI → Release + npm.
Then prove the product claim from a consumer's seat: on a machine/container with no
Bun and no repo checkout, `npm install -g @semideus/code` → `daimon` runs a real session
against a real key; separately download the raw binary from the Release page and do
the same. Close the loop in the docs: STATUS.md gains the "published" row, the honesty
ledger rows this closes get closed.

## Done when (verification criteria)

- Pushing `vX.Y.Z` where the version matches produces, with no human steps: a GitHub
  Release holding four binaries + `SHA256SUMS`, and `@semideus/code@X.Y.Z` on npm with
  provenance — and a deliberately mismatched tag (tested once, e.g. `v0.0.99-test`)
  fails the guard and publishes *nothing*, no Release, no npm.
- `npm install -g @semideus/code` on a clean machine without Bun yields a working
  `daimon` — checksum verified during postinstall — and the direct-download binary from
  the Release page works identically.
- The README's install instructions have been executed verbatim on a clean environment
  and worked unedited.
- Git history is public with zero secrets (scan output kept with the release notes of
  `v0.1.0`).
- `bun run release` cuts a version end-to-end and refuses to tag when the local gate
  is red.

## Out of scope (v1)

Homebrew tap and curl installer (next, once two or three tagged releases have proven
the pipeline) · changelog automation / conventional-commits tooling · auto-update and
update notifications · macOS notarization, Windows signing (ledgered in the packaging
brief) · nightly/canary channels · publishing any workspace package besides the
wrapper.
