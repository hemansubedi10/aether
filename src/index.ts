import * as path from "node:path";
import * as os from "node:os";
import { RouterEngine } from "./router-engine.js";
import { HealthTracker } from "./health.js";
import { getConfig } from "./config.js";
import { ToolRegistry } from "./tools/registry.js";
import { makeReadFileTool, makeWriteFileTool, makeEditFileTool, makeListDirTool, makeBashTool } from "./tools/filesystem.js";
import { makeGlobTool } from "./tools/glob.js";
import { makeGrepTool } from "./tools/grep.js";
import { makeWebSearchTool } from "./tools/websearch.js";
import { makeVisionTool } from "./tools/vision.js";
import { makeGitTool } from "./tools/git.js";
import { Agent } from "./agent.js";
import { Session } from "./session.js";
import { Arena } from "./arena.js";
import { Memory } from "./memory.js";
import { ModeManager } from "./modes.js";
import { CostTracker } from "./cost.js";
import { Settings } from "./settings.js";
import { createTUI } from "./tui.js";
import type { ChatChunk, Message, ToolDef } from "./types.js";

export async function runChat(
  messages: Message[],
  tools: ToolDef[] = [],
  opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<{ text: string; toolCalls: any[]; usage?: { input_tokens: number; output_tokens: number } }> {
  const cfg = getConfig();
  const engine = new RouterEngine();
  let text = "";
  const toolCalls: any[] = [];
  let usage: ChatChunk["usage"];
  try {
    const result = await engine.chat(messages, tools, opts);
    text = result.text;
    toolCalls.push(...result.toolCalls);
    usage = result.usage;
  } catch (err) {
    throw new Error((err as Error).message);
  }
  return { text, toolCalls, usage };
}

function makeRouterAdapter(engine: RouterEngine) {
  const adapter: any = {
    configs: engine.configs_,
    activeProvider: undefined as string | undefined,
    activeModel: undefined as string | undefined,
    chat: (messages: any, tools: any, opts?: any) => engine.chatStream(messages, tools, opts),
    select: () => null,
    setActiveProvider: (n?: string) => { adapter.activeProvider = n; },
    setActiveModel: (m: string) => { adapter.activeModel = m; },
    getActiveProvider: () => adapter.activeProvider,
    getActiveModel: () => adapter.activeModel,
    getProviderNames: () => engine.configs_.filter((c: any) => c.enabled).map((c: any) => c.name),
    getModelsFor: (name?: string) => {
      const c = engine.configs_.find((cfg: any) => cfg.name === (name ?? adapter.activeProvider));
      return c?.models ?? [];
    },
    listAllModels: () => engine.listFreeModels(),
    healthAll: () => engine.healthAll(),
    resetHealth: () => engine.resetHealth(),
  };
  return adapter;
}

export function createAgent(rootDir: string = process.cwd()): Agent {
  const cfg = getConfig();
  const engine = new RouterEngine();
  const router = makeRouterAdapter(engine);
  const registry = new ToolRegistry();
  const factories = [
    makeReadFileTool,
    makeWriteFileTool,
    makeEditFileTool,
    makeListDirTool,
    makeBashTool,
    makeGlobTool,
    makeGrepTool,
    makeWebSearchTool,
    makeVisionTool,
    makeGitTool,
  ];
  for (const make of factories) {
    const tool = make(rootDir);
    registry.register(tool.def, tool.execute);
  }
  const memory = new Memory();
  const modeManager = new ModeManager();
  return new Agent(router, registry, { memory, modeManager });
}

export function createTUIContext(rootDir: string = process.cwd()) {
  const cfg = getConfig();
  const engine = new RouterEngine();
  const router = makeRouterAdapter(engine);
  const registry = new ToolRegistry();
  for (const make of [makeReadFileTool, makeWriteFileTool, makeEditFileTool, makeListDirTool, makeBashTool, makeGlobTool, makeGrepTool, makeWebSearchTool, makeVisionTool, makeGitTool]) {
    const tool = make(rootDir);
    registry.register(tool.def, tool.execute);
  }
  const agent = new Agent(router, registry, { memory: new Memory(), modeManager: new ModeManager() });
  const session = new Session();
  const arena = new Arena(router);
  const costTracker = CostTracker.load();
  const settings = Settings.load();
  const skills = Skills.instance();
  const checkpoint = Checkpoint.instance();
  const tui = createTUI({ agent, router, session, arena, costTracker, settings, skills, checkpoint });
  return { agent, router, session, arena, costTracker, settings, tui };
}

export { RouterEngine, HealthTracker, getConfig, Agent, ToolRegistry, Session, Arena, createTUI, Memory, ModeManager, CostTracker, GitTool, Checkpoint, Skills };
import { GitTool } from "./git.js";
import { Checkpoint } from "./checkpoint.js";
import { Skills } from "./skills.js";

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
  // Parse CLI flags: --plan and --yolo set the agent mode and are stripped
  // from the prompt args.
  let modeFlag: string | null = null;
  const promptArgs: string[] = [];
  for (const arg of process.argv.slice(2)) {
    if (arg === "--plan") {
      modeFlag = "plan";
    } else if (arg === "--yolo") {
      modeFlag = "yolo";
    } else {
      promptArgs.push(arg);
    }
  }
  const prompt = promptArgs.join(" ").trim();

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
        // Honor AETHER_MODEL / AETHER_PROVIDER env vars in one-shot mode so
        // local Ollama models can be selected without an interactive TUI.
        if (process.env.AETHER_PROVIDER) {
          agent.router.setActiveProvider(process.env.AETHER_PROVIDER);
        }
        if (process.env.AETHER_MODEL) {
          agent.router.setActiveModel(process.env.AETHER_MODEL);
        }
        const session = new Session();
        const costTracker = CostTracker.load();
  const settings = Settings.load();
        const provider = agent.router.getActiveProvider() ?? "unknown";
        const model = agent.router.getActiveModel() ?? "default";
        if (modeFlag) agent.setMode(modeFlag);

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
          if (chunk.type === "done" && chunk.usage) {
            costTracker.record(provider, model, chunk.usage.input_tokens, chunk.usage.output_tokens);
          }
        }
        CostTracker.save(costTracker);

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
