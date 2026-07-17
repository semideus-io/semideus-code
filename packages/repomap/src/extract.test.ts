import { describe, expect, test } from "bun:test";
import { extract } from "./extract";

const FIXTURE = `import { helper } from "./other";

export function runTurn(s: Session, msg: string): Promise<void> {
  const inner = () => helper(s);
  return inner();
}

export class PermissionGate {
  check(): boolean {
    return true;
  }
}

interface Hidden {
  x: number;
}

export type ToolMode = "native" | "json-fallback";

export enum Level {
  Low = 0,
}

export const MAX_STEPS = 32;
const secret = "not exported";
`;

describe("extract", () => {
  test("finds every top-level def kind with signature, line, and export flag", async () => {
    const { defs } = await extract("fixture.ts", FIXTURE);
    const byName = new Map(defs.map((d) => [d.name, d]));

    expect(byName.get("runTurn")).toMatchObject({
      kind: "function",
      exported: true,
      line: 3,
      signature: "export function runTurn(s: Session, msg: string): Promise<void>",
    });
    expect(byName.get("PermissionGate")).toMatchObject({ kind: "class", exported: true });
    expect(byName.get("Hidden")).toMatchObject({ kind: "interface", exported: false });
    expect(byName.get("ToolMode")).toMatchObject({ kind: "type", exported: true });
    expect(byName.get("Level")).toMatchObject({ kind: "enum", exported: true });
    expect(byName.get("MAX_STEPS")).toMatchObject({ kind: "const", exported: true });
    expect(byName.get("secret")).toMatchObject({ kind: "const", exported: false });

    // The nested arrow function is not a top-level def.
    expect(byName.has("inner")).toBe(false);
    // Defs come back in source order.
    expect(defs.map((d) => d.name)).toEqual([
      "runTurn",
      "PermissionGate",
      "Hidden",
      "ToolMode",
      "Level",
      "MAX_STEPS",
      "secret",
    ]);
  });

  test("counts identifier occurrences for cross-file matching", async () => {
    const { idents } = await extract("fixture.ts", FIXTURE);
    expect(idents.helper).toBe(2); // import + call
    expect(idents.Session).toBe(1); // type position counts too
    expect(idents.runTurn).toBe(1); // its own declaration
  });

  test("empty source yields an empty extract, not a throw", async () => {
    expect(await extract("empty.ts", "")).toEqual({ defs: [], idents: {} });
  });

  test("broken source never throws and keeps what tree-sitter can recover", async () => {
    const broken = "export function ok(): void {}\n}{ not code at all\nexport const alsoOk = 1;\n";
    const { defs } = await extract("broken.ts", broken);
    // Recovery scope is the grammar's call; the contract is: no throw, valid
    // defs outside the damage survive.
    expect(defs.map((d) => d.name)).toContain("ok");
  });

  test("unsupported extensions degrade to an empty extract", async () => {
    expect(await extract("README.md", "# heading")).toEqual({ defs: [], idents: {} });
  });

  test("consts inside an initializer body never leak out as top-level defs", async () => {
    const source = `export const tool = {
  run: async () => {
    const inner = 1;
    const alsoInner = 2;
    return inner + alsoInner;
  },
};
`;
    const { defs } = await extract("tool.ts", source);
    expect(defs.map((d) => d.name)).toEqual(["tool"]);
  });

  test("tsx components extract from tsx files", async () => {
    const tsx = "export function App() {\n  return <div>hi</div>;\n}\n";
    const { defs } = await extract("app.tsx", tsx);
    expect(defs[0]).toMatchObject({ name: "App", kind: "function", exported: true });
  });
});
