import type { Node } from "web-tree-sitter";
import { parserFor } from "./parser";

export interface DefSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "const";
  /** First source line of the declaration — what the map prints. */
  signature: string;
  /** 1-based. */
  line: number;
  exported: boolean;
}

/** One parsed file, in a JSON-cacheable shape (step 5 persists these). */
export interface FileExtract {
  defs: DefSymbol[];
  /** Identifier occurrence counts — cross-file name matching feeds the graph. */
  idents: Record<string, number>;
}

const EMPTY: FileExtract = { defs: [], idents: {} };

const DEF_KINDS: Record<string, DefSymbol["kind"]> = {
  function_declaration: "function",
  class_declaration: "class",
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
};

function firstSignatureLine(source: string, node: Node): string {
  const text = source.slice(node.startIndex, node.endIndex);
  const line = text.split("\n", 1)[0] ?? "";
  return line.replace(/\s*[{(]?\s*$/, (m) => (m.trim() === "{" ? "" : m.trim())).trimEnd();
}

function isTopLevel(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (parent.type === "program") return true;
  return parent.type === "export_statement" && parent.parent?.type === "program";
}

/**
 * Defs and identifier counts for one file. Never throws: unsupported
 * extensions and unparsable source degrade to an empty extract — tree-sitter
 * reports broken code as ERROR nodes inside a still-usable tree, so partially
 * valid files still yield their valid defs.
 */
export async function extract(path: string, source: string): Promise<FileExtract> {
  const parser = await parserFor(path);
  if (!parser) return EMPTY;
  const tree = parser.parse(source);
  if (!tree) return EMPTY;

  const defs: DefSymbol[] = [];
  const idents: Record<string, number> = {};

  for (const type of Object.keys(DEF_KINDS)) {
    for (const node of tree.rootNode.descendantsOfType(type)) {
      if (!node || !isTopLevel(node)) continue;
      const name = node.childForFieldName("name")?.text;
      const kind = DEF_KINDS[type];
      if (!name || !kind) continue;
      const exported = node.parent?.type === "export_statement";
      defs.push({
        name,
        kind,
        // The export keyword is part of the signature the map should show.
        signature: firstSignatureLine(source, exported && node.parent ? node.parent : node),
        line: node.startPosition.row + 1,
        exported,
      });
    }
  }

  // Top-level const/let bindings (the arrow-function idiom included).
  for (const node of tree.rootNode.descendantsOfType("lexical_declaration")) {
    if (!node || !isTopLevel(node)) continue;
    const exported = node.parent?.type === "export_statement";
    const sigNode = exported && node.parent ? node.parent : node;
    for (const declarator of node.descendantsOfType("variable_declarator")) {
      const name = declarator?.childForFieldName("name")?.text;
      if (!name) continue;
      defs.push({
        name,
        kind: "const",
        signature: firstSignatureLine(source, sigNode),
        line: node.startPosition.row + 1,
        exported,
      });
    }
  }

  defs.sort((a, b) => a.line - b.line);

  for (const node of tree.rootNode.descendantsOfType(["identifier", "type_identifier"])) {
    const name = node?.text;
    if (name) idents[name] = (idents[name] ?? 0) + 1;
  }

  tree.delete();
  return { defs, idents };
}
