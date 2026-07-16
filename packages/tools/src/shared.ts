import { isAbsolute, relative, resolve } from "node:path";

export function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/** True when `abs` sits inside `cwd`. Mutations outside the workspace are refused. */
export function insideWorkspace(cwd: string, abs: string): boolean {
  const rel = relative(resolve(cwd), abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function displayPath(cwd: string, abs: string): string {
  const rel = relative(resolve(cwd), abs);
  return rel && !rel.startsWith("..") ? rel : abs;
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}
