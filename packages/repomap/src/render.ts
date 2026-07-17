import type { FileExtract } from "./extract";
import type { RankedFile } from "./rank";

export interface RenderOptions {
  /** ~4 chars per token heuristic; the map never exceeds this. */
  budgetTokens?: number;
  /** Signature lines shown per file — exported defs win the slots. */
  maxDefsPerFile?: number;
}

const BUDGET_TOKENS = 1_000;
const MAX_DEFS_PER_FILE = 8;
const MAX_SIGNATURE_CHARS = 120;
const CHARS_PER_TOKEN = 4;

function sectionFor(path: string, extract: FileExtract, maxDefs: number): string | null {
  if (extract.defs.length === 0) return null;
  const defs = [...extract.defs]
    .sort((a, b) => Number(b.exported) - Number(a.exported) || a.line - b.line)
    .slice(0, maxDefs)
    .sort((a, b) => a.line - b.line);
  const lines = defs.map((d) => {
    const sig =
      d.signature.length > MAX_SIGNATURE_CHARS
        ? `${d.signature.slice(0, MAX_SIGNATURE_CHARS - 1)}…`
        : d.signature;
    return `  ${sig}`;
  });
  const hidden = extract.defs.length - defs.length;
  if (hidden > 0) lines.push(`  … ${hidden} more`);
  return `${path}:\n${lines.join("\n")}`;
}

/**
 * The top-ranked slice of the repo as signature lines, hard-capped by the
 * token budget. Sections are all-or-nothing: the first file that would
 * overflow the budget ends the map, so it never cuts mid-file. Files with
 * nothing to show (no defs — pure consumers, unparsable) are skipped.
 */
export function renderMap(
  ranked: RankedFile[],
  extracts: Record<string, FileExtract>,
  opts: RenderOptions = {},
): string {
  const budgetChars = (opts.budgetTokens ?? BUDGET_TOKENS) * CHARS_PER_TOKEN;
  const maxDefs = opts.maxDefsPerFile ?? MAX_DEFS_PER_FILE;

  const sections: string[] = [];
  let used = 0;
  for (const { path } of ranked) {
    const extract = extracts[path];
    if (!extract) continue;
    const section = sectionFor(path, extract, maxDefs);
    if (!section) continue;
    const cost = section.length + 1; // the joining newline
    if (used + cost > budgetChars) break;
    sections.push(section);
    used += cost;
  }
  return sections.join("\n");
}
