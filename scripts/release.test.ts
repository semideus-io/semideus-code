import { describe, expect, test } from "bun:test";
import { bumpPackageText, bumpVersion, tagFor } from "./release";

describe("bumpVersion", () => {
  test("patch, minor, major", () => {
    expect(bumpVersion("0.1.2", "patch")).toBe("0.1.3");
    expect(bumpVersion("0.1.2", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.2", "major")).toBe("1.0.0");
  });

  test("explicit version passes through, garbage and no-ops refuse", () => {
    expect(bumpVersion("0.0.1", "0.1.0")).toBe("0.1.0");
    expect(() => bumpVersion("0.0.1", "banana")).toThrow("neither");
    expect(() => bumpVersion("0.0.1", "0.0.1")).toThrow("already at");
    expect(() => bumpVersion("not-semver", "patch")).toThrow("not plain");
  });
});

test("tagFor prefixes v — the shape release.yml triggers on and guards against", () => {
  expect(tagFor("0.1.0")).toBe("v0.1.0");
});

describe("bumpPackageText", () => {
  test("replaces only the version line, preserving formatting", () => {
    const text = '{\n  "name": "@semideus/code",\n  "version": "0.0.1",\n  "x": "0.0.1"\n}\n';
    const out = bumpPackageText(text, "0.0.1", "0.1.0");
    expect(out).toContain('"version": "0.1.0"');
    expect(out).toContain('"x": "0.0.1"');
  });

  test("refuses when the current version is not found", () => {
    expect(() => bumpPackageText("{}", "0.0.1", "0.1.0")).toThrow("does not contain");
  });
});
