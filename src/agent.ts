import type { Router } from "./router.js";
import { ToolRegistry } from "./tools/registry.js";
import type { ChatChunk, Message, ToolCall } from "./types.js";
import type { Memory } from "./memory.js";
import type { ModeManager } from "./modes.js";

const DEFAULT_MAX_STEPS = 15;

// Best-effort repair of tool-call arguments. Some models emit non-JSON strings
// (e.g. `@{path=foo; content=bar}`); others pass an already-parsed object.
// Handle both so tools always receive a proper args object.
function parseToolArgs(raw: any): Record<string, any> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return {};
  const str = raw.trim();
  if (!str) return {};
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to repair
  }
  const args: Record<string, any> = {};
  const re = /([A-Za-z_][\w.-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^;}\s,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4];
    if (key !== undefined && val !== undefined) args[key] = val;
  }
  return args;
}

const SYSTEM_PROMPT = `You are an expert AI software engineer with the ability to read, write, edit files, list directories, run shell commands, search the web, and describe images.

WORKFLOW:
1. Explore first: use ListDir to understand the project structure, then ReadFile to inspect relevant files.
2. Implement: use WriteFile (for new files) or EditFile (for targeted changes). Write clean, production-quality code.
3. Verify: use Bash to run tests, typecheck, or lint after making changes.
4. Never guess file contents - always read before editing.

STYLE:
- Be concise and direct. Do not narrate your actions excessively.
- Make changes in the smallest, most targeted way possible.
- Only use tools when needed; do not call tools unnecessarily.
- When a task is complete, summarize what was done in 1-2 sentences.
- If a tool fails, read the error and retry with a fix.

TRUSTWORTHY TOOL RESULTS:
- When a tool returns output, treat the tool output as the ground truth. Quote or reference the actual tool output verbatim rather than summarizing it from memory.
- If a tool returned no matches or an empty result, say exactly that ("no matches found") and show the tool output verbatim - never invent files, line numbers, counts, or facts that the tool did not report.
- Do not assume a tool succeeded if its output contains an ERROR: prefix; report the error to the user.
- When counting or summarizing tool output (e.g. "how many files"), base your answer strictly on the returned lines and say how you derived it.`;

export class Agent {
  readonly router: Router;
  readonly registry: ToolRegistry;
  readonly maxSteps: number;
  readonly systemPrompt: string;
  readonly memory?: Memory;
  readonly modeManager?: ModeManager;
  lastMessages: Message[] = [];

  constructor(
    router: Router,
    registry: ToolRegistry,
    opts?: {
      maxSteps?: number;
      systemPrompt?: string;
      memory?: Memory;
      modeManager?: ModeManager;
    }
  ) {
    this.router = router;
    this.registry = registry;
    this.maxSteps = opts?.maxSteps ?? DEFAULT_MAX_STEPS;
    this.systemPrompt = opts?.systemPrompt ?? SYSTEM_PROMPT;
    this.memory = opts?.memory;
    this.modeManager = opts?.modeManager;
  }

  setMode(name: string): void {
    if (!this.modeManager) throw new Error("Agent has no ModeManager");
    this.modeManager.setMode(name);
  }

  getMode(): string {
    return this.modeManager?.getMode() ?? "normal";
  }

  getActiveTools(): string[] {
    if (!this.modeManager) return this.registry.list().map((d) => d.name);
    return this.modeManager.allowedTools();
  }

  async *run(userMessage: string, history: Message[]): AsyncGenerator<ChatChunk, void> {
    const systemMsg: Message = { role: "system", content: this.systemPrompt };
    this.lastMessages = [systemMsg, ...history, { role: "user", content: userMessage }];

    for (let step = 0; step < this.maxSteps; step++) {
      const tools = this.registry.list();
      let assistantText = "";
      const toolCalls: ToolCall[] = [];

      for await (const chunk of this.router.chat(this.lastMessages, tools, {
        temperature: 0.7,
        maxTokens: 4096,
      })) {
        if (chunk.type === "text" && chunk.text) {
          assistantText += chunk.text;
        }
        if (chunk.type === "tool_call" && chunk.tool_call) {
          toolCalls.push(chunk.tool_call);
        }
        yield chunk;
      }

      const assistantMsg: Message = {
        role: "assistant",
        content: assistantText,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      };
      this.lastMessages.push(assistantMsg);

      if (toolCalls.length === 0) {
        return;
      }

      for (const tc of toolCalls) {
        const parsed = parseToolArgs(tc.function.arguments);
        const result = await this.registry.executeTool(tc.function.name, parsed);
        this.lastMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: result,
        });
      }
    }

    this.lastMessages.push({
      role: "assistant",
      content: "\n\n[Reached maximum steps. Stopping.]",
    });
  }
}