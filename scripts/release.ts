#!/usr/bin/env bun
/**
 * Cut a release: bump packages/cli/package.json, run the local gate
 * (verify + build + keyless checks + a live smoke through the compiled
 * binary), commit, and tag. It never pushes — the human pushes the tag,
 * and that push is what triggers .github/workflows/release.yml.
 *
 *   bun run release <patch|minor|major|X.Y.Z> [notes…]
 *
 * Extra args become the tag annotation body, which release.yml turns into
 * the GitHub Release notes (--notes-from-tag).
 */
import { artifactFor } from "./build-npm";

export function bumpVersion(current: string, spec: string): string {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`current version "${current}" is not plain X.Y.Z semver`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  switch (spec) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default: {
      if (!/^\d+\.\d+\.\d+$/.test(spec)) {
        throw new Error(`"${spec}" is neither patch|minor|major nor an explicit X.Y.Z`);
      }
      if (spec === current) throw new Error(`already at ${current}`);
      return spec;
    }
  }
}

export function tagFor(version: string): string {
  return `v${version}`;
}

/** Replace the version in raw package.json text without reformatting the file. */
export function bumpPackageText(text: string, current: string, next: string): string {
  const needle = `"version": "${current}"`;
  if (!text.includes(needle)) throw new Error(`package.json does not contain ${needle}`);
  return text.replace(needle, `"version": "${next}"`);
}

function run(cmd: string[], opts: { capture?: boolean } = {}): string {
  const proc = Bun.spawnSync(cmd, {
    stdout: opts.capture ? "pipe" : "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  if (proc.exitCode !== 0) throw new Error(`${cmd.join(" ")} exited ${proc.exitCode}`);
  return opts.capture ? (proc.stdout?.toString().trim() ?? "") : "";
}

if (import.meta.main) {
  const [spec, ...notesParts] = process.argv.slice(2);
  if (!spec) {
    console.error("usage: bun run release <patch|minor|major|X.Y.Z> [notes…]");
    process.exit(1);
  }

  const pkgPath = "packages/cli/package.json";
  const pkgText = await Bun.file(pkgPath).text();
  const current = (JSON.parse(pkgText) as { version: string }).version;
  const next = bumpVersion(current, spec);
  const tag = tagFor(next);

  // Preconditions — refuse before touching anything.
  const branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  if (branch !== "main") throw new Error(`releases cut from main only (on ${branch})`);
  if (run(["git", "status", "--porcelain"], { capture: true }) !== "") {
    throw new Error("working tree not clean — commit or stash first");
  }
  const tagExists = Bun.spawnSync(["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
  if (tagExists.exitCode === 0) throw new Error(`tag ${tag} already exists`);
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY not set — the pre-tag gate smokes through the compiled binary",
    );
  }
  const host = artifactFor(process.platform, process.arch);
  if (!host) throw new Error(`unsupported release host: ${process.platform}-${process.arch}`);

  console.log(`release: ${current} → ${next}`);
  await Bun.write(pkgPath, bumpPackageText(pkgText, current, next));

  try {
    run(["bun", "run", "verify"]);
    run(["bun", "run", "build"]);
    const binary = `dist/${host}`;
    const printed = run([binary, "--version"], { capture: true });
    if (printed !== next) {
      throw new Error(`${binary} --version printed "${printed}", expected "${next}"`);
    }
    // Live smoke through the compiled binary — read-only task on the cheap model.
    console.log(`release: smoking ${binary} against the live API (cheap model)…`);
    run([
      binary,
      "-p",
      "Read package.json with the read_file tool and answer in one sentence: what is the name field?",
      "-m",
      "cheap",
    ]);
  } catch (err) {
    Bun.spawnSync(["git", "checkout", "--", pkgPath]);
    console.error(`release: gate red — version bump reverted, nothing tagged`);
    throw err;
  }

  const notes = notesParts.join(" ").trim();
  run(["git", "add", pkgPath]);
  run(["git", "commit", "-m", `release: ${tag}`]);
  run(["git", "tag", "-a", tag, "-m", `Semideus Code ${tag}${notes ? `\n\n${notes}` : ""}`]);

  console.log(`\ntagged ${tag}. To release, push it:\n\n  git push origin main ${tag}\n`);
  console.log(
    "(the push triggers release.yml: verify → build → per-OS checks → GitHub Release → npm)",
  );
}
