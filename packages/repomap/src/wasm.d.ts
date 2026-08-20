/**
 * `import … with { type: "file" }` resolves to a path string: the real file in
 * source runs, an embedded asset inside a compiled binary (ADR-0010).
 */
declare module "*.wasm" {
  const path: string;
  export default path;
}
