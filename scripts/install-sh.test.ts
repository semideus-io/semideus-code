import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// install.sh is the curl-pipe installer. Same contract as the npm wrapper's
// postinstall: fetch binary + SHA256SUMS from a base URL, verify, install —
// a tampered download must never land on disk.

const FAKE_BINARY = '#!/bin/sh\necho "0.0.0-fake"\n';

function sha256(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

const HOST_ARTIFACT = `daimon-${process.platform === "darwin" ? "darwin" : "linux"}-${
  process.arch === "arm64" ? "arm64" : "x64"
}`;
const SUMS = `${sha256(FAKE_BINARY)}  ${HOST_ARTIFACT}\n`;

describe("install.sh end to end", () => {
  let server: ReturnType<typeof Bun.serve>;
  let dir: string;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path.endsWith("/SHA256SUMS")) return new Response(SUMS);
        if (path.startsWith("/good/")) return new Response(FAKE_BINARY);
        return new Response("tampered bytes — wrong content");
      },
    });
    dir = mkdtempSync(join(tmpdir(), "daimon-install-sh-"));
  });

  afterAll(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  async function runInstall(
    subdir: string,
    urlPath: string,
  ): Promise<{ code: number; installed: boolean; stderr: string }> {
    const installDir = join(dir, subdir);
    const proc = Bun.spawn(["sh", join(import.meta.dir, "..", "install.sh")], {
      env: {
        ...process.env,
        DAIMON_BINARY_URL: `${server.url.origin}${urlPath}`,
        DAIMON_INSTALL_DIR: installDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    const installed = await Bun.file(join(installDir, "daimon")).exists();
    return { code, installed, stderr };
  }

  test("downloads, verifies, and installs an executable daimon", async () => {
    const { code, installed } = await runInstall("good", "/good");
    expect(code).toBe(0);
    expect(installed).toBe(true);
    const out = Bun.spawnSync([join(dir, "good", "daimon"), "--version"]);
    expect(out.stdout.toString().trim()).toBe("0.0.0-fake");
  });

  test("a tampered download fails the checksum and installs nothing", async () => {
    const { code, installed, stderr } = await runInstall("tampered", "/tampered");
    expect(code).toBe(1);
    expect(installed).toBe(false);
    expect(stderr).toContain("checksum mismatch");
  });
});
