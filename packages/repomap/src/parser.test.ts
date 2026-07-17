import { describe, expect, test } from "bun:test";
import { grammarFor, parserFor } from "./parser";

describe("grammarFor", () => {
  test("routes extensions to their grammar and rejects the rest", () => {
    expect(grammarFor("a/b.ts")).toBe("typescript");
    expect(grammarFor("a/b.js")).toBe("typescript");
    expect(grammarFor("a/b.tsx")).toBe("tsx");
    expect(grammarFor("a/b.jsx")).toBe("tsx");
    expect(grammarFor("a/b.md")).toBeNull();
    expect(grammarFor("Makefile")).toBeNull();
  });
});

describe("parserFor (the phase-1 spike: WASM grammars under Bun)", () => {
  test("parses a real TypeScript snippet into a named tree", async () => {
    const parser = await parserFor("sample.ts");
    expect(parser).not.toBeNull();
    const tree = parser?.parse(
      "export function greet(name: string): string {\n  return `hi ${name}`;\n}\n",
    );
    expect(tree?.rootNode.type).toBe("program");
    expect(tree?.rootNode.hasError).toBe(false);
    const exported = tree?.rootNode.child(0);
    expect(exported?.type).toBe("export_statement");
    expect(tree?.rootNode.descendantsOfType("function_declaration")).toHaveLength(1);
  });

  test("tsx grammar parses JSX; broken source yields ERROR nodes, not a throw", async () => {
    const parser = await parserFor("app.tsx");
    const good = parser?.parse("export const X = () => <div>hi</div>;\n");
    expect(good?.rootNode.hasError).toBe(false);

    const broken = parser?.parse("export function ( {{{ oops\n");
    expect(broken?.rootNode.hasError).toBe(true); // degraded tree, no exception
  });

  test("unsupported files get no parser instead of a crash", async () => {
    expect(await parserFor("README.md")).toBeNull();
  });
});
