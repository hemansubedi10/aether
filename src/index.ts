import * as path from "node:path";
import * as os from "node:os";
import { Router } from "./router.js";
import { HealthTracker } from "./health.js";
import { getConfig } from "./config.js";
import { ToolRegistry } from "./tools/registry.js";
import {
  makeReadFileTool,
  makeWriteFileTool,
  makeEditFileTool,
  makeListDirTool,
  makeBashTool,
} from "./tools/filesystem.js";
import { Agent } from "./agent.js";
import { Session } from "./session.js";
import { Arena } from "./arena.js";
import { createTUI } from "./tui.js";
import type { ChatChunk, Message, ToolDef } from "./types.js";

export async function runChat(
  messages: Message[],
  tools: ToolDef[] = [],
  opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<{ text: string; toolCalls: any[]; usage?: { input_tokens: number; output_tokens: number } }> {
  const cfg = getConfig();
  const router = new Router(cfg.providers, new HealthTracker());
  let text = "";
  const toolCalls: any[] = [];
  let usage: ChatChunk["usage"];
  for await (const chunk of router.chat(messages, tools, opts)) {
    if (chunk.type === "text" && chunk.text) text += chunk.text;
    if (chunk.type === "tool_call" && chunk.tool_call) toolCalls.push(chunk.tool_call);
    if (chunk.type === "done") usage = chunk.usage;
    if (chunk.type === "error") {
      throw new Error(chunk.error || "router error");
    }
  }
  return { text, toolCalls, usage };
}

export function createAgent(rootDir: string = process.cwd()): Agent {
  const cfg = getConfig();
  const router = new Router(cfg.providers, new HealthTracker());
  const registry = new ToolRegistry();
  const factories = [
    makeReadFileTool,
    makeWriteFileTool,
    makeEditFileTool,
    makeListDirTool,
    makeBashTool,
  ];
  for (const make of factories) {
    const tool = make(rootDir);
    registry.register(tool.def, tool.execute);
  }
  return new Agent(router, registry);
}

export function createTUIContext(rootDir: string = process.cwd()) {
  const cfg = getConfig();
  const router = new Router(cfg.providers, new HealthTracker());
  const registry = new ToolRegistry();
  for (const make of [makeReadFileTool, makeWriteFileTool, makeEditFileTool, makeListDirTool, makeBashTool]) {
    const tool = make(rootDir);
    registry.register(tool.def, tool.execute);
  }
  const agent = new Agent(router, registry);
  const session = new Session();
  const arena = new Arena(router);
  const tui = createTUI({ agent, router, session, arena });
  return { agent, router, session, arena, tui };
}

export { Router, HealthTracker, getConfig, Agent, ToolRegistry, Session, Arena, createTUI };

// CLI entrypoint
function isMainModule(): boolean {
  // Robust across tsx/Node and Windows path formatting.
  const self = import.meta.url.replace(/\/$/g, "");
  const argv1 = "file://" + path.resolve(process.argv[1] ?? "");
  if (self === argv1) return true;
  // Also match when invoked via `tsx` where argv may be a .ts source file.
  try {
    const selfPath = new URL(self).pathname;
    const argvPath = path.resolve(process.argv[1] ?? "");
    const norm = (p: string) => p.toLowerCase().replace(/\\/g, "/").replace(/^\//, "");
    if (norm(selfPath) === norm(argvPath)) return true;
  } catch {
    // ignore
  }
  return false;
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  const prompt = args.join(" ").trim();

  if (!prompt) {
    // Interactive TUI mode.
    const { tui } = createTUIContext();
    tui.start();
  } else if (prompt.startsWith("/")) {
    // A single command in non-interactive mode.
    const { tui } = createTUIContext();
    tui.handleCommand(prompt).then(() => process.exit(0)).catch((err) => {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    });
  } else {
    // One-shot prompt: run the agent, print the answer, save the session.
    (async () => {
      try {
        const agent = createAgent();
        const session = new Session();
        let assistantText = "";
        for await (const chunk of agent.run(prompt, session.messages)) {
          if (chunk.type === "text" && chunk.text) {
            process.stdout.write(chunk.text);
            assistantText += chunk.text;
          }
          if (chunk.type === "tool_call" && chunk.tool_call) {
            process.stderr.write(`\n[Tool: ${chunk.tool_call.function.name}]\n`);
          }
          if (chunk.type === "error" && chunk.error) {
            process.stderr.write(`\n[error] ${chunk.error}\n`);
          }
        }
        if (agent.lastMessages.length > 0) {
          session.messages = agent.lastMessages.filter((m) => m.role !== "system");
        }
        const sessions = Session.list();
        const file = sessions[0]?.file ?? path.join(os.homedir(), ".aether", "sessions", "session.json");
        Session.save(file, session);
        process.stdout.write("\n");
      } catch (err) {
        process.stderr.write(`error: ${(err as Error).message}\n`);
        process.exit(1);
      }
    })();
  }
}
