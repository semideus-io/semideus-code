import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extract, type FileExtract } from "./extract";
import { rankFiles } from "./rank";
import { renderMap } from "./render";

const CACHE_VERSION = 1;
const SKIP_SEGMENTS = new Set(["node_modules", "dist", "coverage", ".demi"]);
/** Minified bundles and generated monsters don't belong on the map. */
const MAX_FILE_BYTES = 400_000;
const SOURCE_GLOB = "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}";

interface CacheEntry {
  mtimeMs: number;
  extract: FileExtract;
}

interface CacheShape {
  version: number;
  files: Record<string, CacheEntry>;
}

export interface BuildOptions {
  budgetTokens?: number;
  /** Rank mass per repo-relative path (files touched this session). */
  personalization?: Record<string, number>;
}

export interface BuildResult {
  map: string;
  /** Source files considered. */
  files: number;
  /** Files (re)parsed this run — 0 on a fully warm cache. */
  parsed: number;
}

function cachePath(cwd: string): string {
  return join(cwd, ".demi", "cache", "repomap.json");
}

async function loadCache(cwd: string): Promise<Record<string, CacheEntry>> {
  try {
    const raw = (await Bun.file(cachePath(cwd)).json()) as CacheShape;
    if (raw?.version !== CACHE_VERSION || typeof raw.files !== "object" || raw.files === null) {
      return {};
    }
    return raw.files;
  } catch {
    return {}; // missing or corrupt cache — a full rebuild, never an error
  }
}

function saveCache(cwd: string, files: Record<string, CacheEntry>): void {
  try {
    const path = cachePath(cwd);
    mkdirSync(dirname(path), { recursive: true });
    const shape: CacheShape = { version: CACHE_VERSION, files };
    writeFileSync(path, JSON.stringify(shape));
  } catch {
    // A read-only workspace just rebuilds next time.
  }
}

function skipped(relPath: string): boolean {
  return relPath
    .split("/")
    .some((segment) => SKIP_SEGMENTS.has(segment) || segment.startsWith("."));
}

/**
 * Walk the workspace, (re)extract what changed since the cached run, rank,
 * render. The extract graph is cached by mtime in .demi/cache/repomap.json;
 * ranking and rendering run fresh each build (they're cheap and take the
 * personalization of the moment).
 */
export async function buildRepoMap(cwd: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const glob = new Bun.Glob(SOURCE_GLOB);
  const paths: string[] = [];
  for await (const rel of glob.scan({ cwd, dot: false })) {
    if (!skipped(rel)) paths.push(rel);
  }
  paths.sort();

  const cache = await loadCache(cwd);
  const fresh: Record<string, CacheEntry> = {};
  const extracts: Record<string, FileExtract> = {};
  let parsed = 0;

  for (const rel of paths) {
    const file = Bun.file(join(cwd, rel));
    const mtimeMs = file.lastModified;
    const cached = cache[rel];
    if (cached && cached.mtimeMs === mtimeMs) {
      fresh[rel] = cached;
      extracts[rel] = cached.extract;
      continue;
    }
    if (file.size > MAX_FILE_BYTES) continue;
    const extracted = await extract(rel, await file.text());
    parsed++;
    fresh[rel] = { mtimeMs, extract: extracted };
    extracts[rel] = extracted;
  }

  saveCache(cwd, fresh);

  const ranked = rankFiles(extracts, { personalization: opts.personalization });
  const map = renderMap(ranked, extracts, { budgetTokens: opts.budgetTokens });
  return { map, files: paths.length, parsed };
}
