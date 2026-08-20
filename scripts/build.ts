import { join } from "node:path";
import cliPkg from "../packages/cli/package.json" with { type: "json" };

/**
 * Compile the four release binaries (ADR-0010, packaging brief step 3).
 * `bun run build` → dist/daimon-<os>-<arch>[.exe] + dist/SHA256SUMS.
 * Bun cross-compiles every target from one host; windows is experimental.
 */

export const TARGETS = [
  { target: "bun-linux-x64", artifact: "daimon-linux-x64" },
  { target: "bun-darwin-arm64", artifact: "daimon-darwin-arm64" },
  { target: "bun-darwin-x64", artifact: "daimon-darwin-x64" },
  { target: "bun-windows-x64", artifact: "daimon-windows-x64.exe" },
] as const;

export const VERSION: string = cliPkg.version;

const ROOT = join(import.meta.dir, "..");
export const DIST = join(ROOT, "dist");

/**
 * Ink statically imports its optional devtools peer (react-devtools-core) from
 * a lazy chunk, and a compiled binary links every import eagerly at startup —
 * so the bare package must exist at bundle time. It is opt-in-by-install and
 * never installed here; stub it to an empty module. The DEV=true guard in ink
 * means the stub is never even read in practice.
 */
const stubReactDevtools = {
  name: "stub-react-devtools",
  setup(build: Bun.PluginBuilder) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core-stub",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default undefined;",
      loader: "js" as const,
    }));
  },
};

export async function compile(
  target: (typeof TARGETS)[number]["target"],
  artifact: string,
): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(ROOT, "packages/cli/src/main.ts")],
    compile: { target, outfile: join(DIST, artifact) },
    plugins: [stubReactDevtools],
  });
  if (!result.success) {
    throw new Error(`${target} failed:\n${result.logs.map((l) => l.message).join("\n")}`);
  }
}

export async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

/** shasum-compatible: `<hex><two spaces><artifact>` — verifiable with `shasum -a 256 -c`. */
export function checksumLine(hex: string, artifact: string): string {
  return `${hex}  ${artifact}`;
}

if (import.meta.main) {
  console.log(`building daimon ${VERSION} → dist/`);
  const lines: string[] = [];
  for (const { target, artifact } of TARGETS) {
    const started = Date.now();
    await compile(target, artifact);
    const file = Bun.file(join(DIST, artifact));
    lines.push(checksumLine(await sha256(join(DIST, artifact)), artifact));
    const mb = (file.size / 1e6).toFixed(0);
    console.log(`  ${artifact}  ${mb}MB  ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  await Bun.write(join(DIST, "SHA256SUMS"), `${lines.join("\n")}\n`);
  console.log(`  SHA256SUMS  (${lines.length} artifacts)`);
}
