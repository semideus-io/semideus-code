import tsxWasm from "tree-sitter-wasms/out/tree-sitter-tsx.wasm" with { type: "file" };
import typescriptWasm from "tree-sitter-wasms/out/tree-sitter-typescript.wasm" with {
  type: "file",
};
import { Language, Parser } from "web-tree-sitter";
import runtimeWasm from "web-tree-sitter/tree-sitter.wasm" with { type: "file" };

/**
 * All three wasm files travel as file imports so `bun build --compile` embeds
 * them: the same import is a node_modules path in source runs and an embedded
 * asset in a compiled binary — no runtime dependence on node_modules (ADR-0010).
 */
const WASM_BY_GRAMMAR: Record<"typescript" | "tsx", string> = {
  typescript: typescriptWasm,
  tsx: tsxWasm,
};

/**
 * Grammar per extension: the typescript grammar covers plain JS too; JSX needs
 * the tsx grammar. Both ship prebuilt in tree-sitter-wasms (ADR-0005).
 */
const GRAMMAR_BY_EXT: Record<string, "typescript" | "tsx"> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".tsx": "tsx",
  ".jsx": "tsx",
};

export function grammarFor(path: string): "typescript" | "tsx" | null {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return null;
  return GRAMMAR_BY_EXT[path.slice(dot)] ?? null;
}

let initialized = false;
const languages = new Map<string, Language>();
const parsers = new Map<string, Parser>();

async function loadLanguage(grammar: "typescript" | "tsx"): Promise<Language> {
  const cached = languages.get(grammar);
  if (cached) return cached;
  if (!initialized) {
    await Parser.init({ locateFile: () => runtimeWasm });
    initialized = true;
  }
  const bytes = new Uint8Array(await Bun.file(WASM_BY_GRAMMAR[grammar]).arrayBuffer());
  const language = await Language.load(bytes);
  languages.set(grammar, language);
  return language;
}

/**
 * Parser for the file's grammar, or null for files the map doesn't cover.
 * Parsers are reused; web-tree-sitter parse failures surface as ERROR nodes
 * in the tree, not exceptions — callers stay throw-free by design.
 */
export async function parserFor(path: string): Promise<Parser | null> {
  const grammar = grammarFor(path);
  if (!grammar) return null;
  const cached = parsers.get(grammar);
  if (cached) return cached;
  const language = await loadLanguage(grammar); // also runs Parser.init()
  const parser = new Parser();
  parser.setLanguage(language);
  parsers.set(grammar, parser);
  return parser;
}
