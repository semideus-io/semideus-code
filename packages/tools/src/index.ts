import type { Tool } from "@semideus/core";
import { bashTool } from "./bash";
import { editFileTool } from "./edit-file";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { readFileTool } from "./read-file";
import { writeFileTool } from "./write-file";

/** The six v1 tools, in the order the plan ships them. */
export const builtinTools: Tool[] = [
  readFileTool as Tool,
  globTool as Tool,
  grepTool as Tool,
  bashTool as Tool,
  writeFileTool as Tool,
  editFileTool as Tool,
];

export { bashTool, editFileTool, globTool, grepTool, readFileTool, writeFileTool };
