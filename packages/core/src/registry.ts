import { tool as aiTool, type ToolSet } from "ai";
import type { Tool } from "./contracts/tool";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /**
   * Schemas only — no execute functions. The loop owns execution so that the
   * permission gate always sits between the model's intent and the world.
   */
  asAiSdkTools(): ToolSet {
    const entries = this.list().map((t) => [
      t.name,
      aiTool({ description: t.description, inputSchema: t.schema }),
    ]);
    return Object.fromEntries(entries);
  }
}
