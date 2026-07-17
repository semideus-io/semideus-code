import type { FileExtract } from "./extract";

export interface RankedFile {
  path: string;
  score: number;
}

export interface RankOptions {
  damping?: number;
  iterations?: number;
  /**
   * Extra rank mass per file (e.g. files touched this session). Missing or
   * empty → uniform. Values are relative weights, any positive scale.
   */
  personalization?: Record<string, number>;
}

const DAMPING = 0.85;
const ITERATIONS = 30;

/**
 * Personalized PageRank over the file graph. Edge B→A with weight n when B's
 * source uses a name n times that A export-defines — Aider's proven design:
 * name matching, no type resolution. A name exported by several files splits
 * its weight among them. Deterministic: ties break by path.
 */
export function rankFiles(
  extracts: Record<string, FileExtract>,
  opts: RankOptions = {},
): RankedFile[] {
  const paths = Object.keys(extracts).sort();
  if (paths.length === 0) return [];
  const index = new Map(paths.map((p, i) => [p, i]));
  const n = paths.length;

  // Who export-defines each name.
  const definers = new Map<string, number[]>();
  for (const path of paths) {
    const extract = extracts[path];
    if (!extract) continue;
    const here = index.get(path) as number;
    for (const def of extract.defs) {
      if (!def.exported) continue;
      const list = definers.get(def.name) ?? [];
      if (!list.includes(here)) list.push(here);
      definers.set(def.name, list);
    }
  }

  // Weighted out-edges per file.
  const edges: Array<Map<number, number>> = paths.map(() => new Map());
  for (const path of paths) {
    const extract = extracts[path];
    if (!extract) continue;
    const from = index.get(path) as number;
    for (const [name, count] of Object.entries(extract.idents)) {
      const targets = definers.get(name);
      if (!targets) continue;
      const foreign = targets.filter((t) => t !== from);
      if (foreign.length === 0) continue;
      const weight = count / foreign.length;
      const out = edges[from] as Map<number, number>;
      for (const target of foreign) {
        out.set(target, (out.get(target) ?? 0) + weight);
      }
    }
  }
  const outWeight = edges.map((out) => {
    let sum = 0;
    for (const w of out.values()) sum += w;
    return sum;
  });

  // Personalization vector, normalized; uniform when nothing is highlighted.
  const personalization = new Float64Array(n).fill(1 / n);
  const given = Object.entries(opts.personalization ?? {}).filter(
    ([p, w]) => index.has(p) && w > 0,
  );
  if (given.length > 0) {
    personalization.fill(0);
    const total = given.reduce((sum, [, w]) => sum + w, 0);
    for (const [path, w] of given) {
      personalization[index.get(path) as number] = w / total;
    }
  }

  const damping = opts.damping ?? DAMPING;
  const iterations = opts.iterations ?? ITERATIONS;
  let rank = Float64Array.from(personalization);
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float64Array(n);
    let dangling = 0;
    for (let v = 0; v < n; v++) {
      const r = rank[v] as number;
      const total = outWeight[v] as number;
      if (total === 0) {
        dangling += r;
        continue;
      }
      for (const [target, w] of edges[v] as Map<number, number>) {
        next[target] = (next[target] as number) + (r * w) / total;
      }
    }
    for (let v = 0; v < n; v++) {
      const p = personalization[v] as number;
      next[v] = (1 - damping) * p + damping * ((next[v] as number) + dangling * p);
    }
    rank = next;
  }

  return paths
    .map((path, i) => ({ path, score: rank[i] as number }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}
