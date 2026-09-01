import type { ToolDef, ToolCall } from "../types.js";

export type ToolExecutor = (args: Record<string, any>) => Promise<string>;

interface RegisteredTool extends ToolDef {
  execute: ToolExecutor;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(def: ToolDef, execute: ToolExecutor): void {
    this.tools.set(def.name, { ...def, execute });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): ToolDef[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  toJSON(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, any> };
  }> {
    return this.list().map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async executeTool(name: string, args: Record<string, any>): Promise<string> {
    const registered = this.tools.get(name);
    if (!registered) {
      return `ERROR: Unknown tool "${name}". Available tools: ${Array.from(this.tools.keys()).join(", ")}`;
    }
    try {
      return await registered.execute(args ?? {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `ERROR executing tool "${name}": ${message}`;
    }
  }
}
