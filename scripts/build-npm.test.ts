import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactFor, parseSha256Sums, renderWrapper } from "./build-npm";

const FAKE_BINARY = "#!/bin/sh\necho fake-daimon\n";

function sha256(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

describe("artifactFor", () => {
  test("maps the four supported platforms, windows with .exe", () => {
    expect(artifactFor("linux", "x64")).toBe("daimon-linux-x64");
    expect(artifactFor("darwin", "arm64")).toBe("daimon-darwin-arm64");
    expect(artifactFor("darwin", "x64")).toBe("daimon-darwin-x64");
    expect(artifactFor("win32", "x64")).toBe("daimon-windows-x64.exe");
  });

  test("unsupported combos are null, not a guess", () => {
    expect(artifactFor("linux", "arm64")).toBeNull();
    expect(artifactFor("freebsd", "x64")).toBeNull();
    expect(artifactFor("win32", "arm64")).toBeNull();
  });
});

describe("parseSha256Sums", () => {
  test("parses shasum lines and ignores junk", () => {
    const hex = "a".repeat(64);
    const parsed = parseSha256Sums(`${hex}  daimon-linux-x64\nnot a line\n\n`);
    expect(parsed).toEqual({ "daimon-linux-x64": hex });
  });
});

describe("renderWrapper", () => {
  const files = renderWrapper({
    version: "1.2.3",
    checksums: { "daimon-darwin-arm64": "b".repeat(64) },
    repoUrl: "https://github.com/example/semideus-code",
  });

  test("package.json is valid, version-locked, with bin + postinstall", () => {
    const pkg = JSON.parse(files["package.json"] ?? "");
    expect(pkg.name).toBe("@semideus/code");
    expect(pkg.version).toBe("1.2.3");
    expect(pkg.license).toBe("Apache-2.0");
    expect(pkg.bin.daimon).toBe("bin/daimon.js");
    expect(pkg.scripts.postinstall).toBe("node install.js");
    expect(pkg.repository.url).toBe("git+https://github.com/example/semideus-code.git");
  });

  test("install.js bakes version, checksums, and the release URL for its version", () => {
    const install = files["install.js"] ?? "";
    expect(install).toContain('"1.2.3"');
    expect(install).toContain("b".repeat(64));
    expect(install).toContain("https://github.com/example/semideus-code/releases/download/v1.2.3");
  });

  test("without a repo url, install.js has no baked base and demands DAIMON_BINARY_URL", () => {
    const bare = renderWrapper({ version: "1.2.3", checksums: {}, repoUrl: null });
    expect(bare["install.js"]).toContain("const RELEASE_BASE = null");
    expect(bare["install.js"]).toContain("DAIMON_BINARY_URL");
  });
});

describe("postinstall end to end", () => {
  let server: ReturnType<typeof Bun.serve>;
  let dir: string;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname.startsWith("/good/")) {
          return new Response(FAKE_BINARY);
        }
        return new Response("tampered bytes — wrong content");
      },
    });
    dir = mkdtempSync(join(tmpdir(), "daimon-npm-"));
  });

  afterAll(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  async function runInstall(
    subdir: string,
    checksums: Record<string, string>,
    urlPath: string,
  ): Promise<{ code: number; vendorExists: boolean; stderr: string }> {
    // The test always requests darwin-arm64 by faking the checksum table for
    // whatever platform the test runs on — install.js derives the artifact from
    // process.platform, so feed it a table keyed for this host.
    const host = artifactFor(process.platform, process.arch);
    if (!host) throw new Error(`test host unsupported: ${process.platform}-${process.arch}`);
    const hostChecksums: Record<string, string> = {};
    for (const [, hex] of Object.entries(checksums)) hostChecksums[host] = hex;

    const files = renderWrapper({ version: "0.0.0", checksums: hostChecksums, repoUrl: null });
    const pkgDir = join(dir, subdir);
    for (const [name, content] of Object.entries(files)) {
      await Bun.write(join(pkgDir, name), content);
    }
    const proc = Bun.spawn(["bun", join(pkgDir, "install.js")], {
      env: { ...process.env, DAIMON_BINARY_URL: `${server.url.origin}${urlPath}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    const suffix = process.platform === "win32" ? "daimon.exe" : "daimon";
    const vendorExists = await Bun.file(join(pkgDir, "vendor", suffix)).exists();
    return { code, vendorExists, stderr };
  }

  test("downloads, verifies, installs, and marks executable", async () => {
    const { code, vendorExists } = await runInstall("good", { any: sha256(FAKE_BINARY) }, "/good");
    expect(code).toBe(0);
    expect(vendorExists).toBe(true);
  });

  test("a tampered download fails the checksum and installs nothing", async () => {
    const { code, vendorExists, stderr } = await runInstall(
      "tampered",
      { any: sha256(FAKE_BINARY) },
      "/tampered",
    );
    expect(code).toBe(1);
    expect(vendorExists).toBe(false);
    expect(stderr).toContain("checksum mismatch");
  });
});
