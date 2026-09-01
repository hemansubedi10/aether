import * as readline from "node:readline";
import * as os from "node:os";
import * as path from "node:path";
import type { ChatChunk, Message } from "./types.js";
import { Agent } from "./agent.js";
import { Session } from "./session.js";
import { Router } from "./router.js";
import { Arena, type ArenaResult } from "./arena.js";
import { CommandHandler, parseCommand, type CommandContext } from "./commands.js";
import { getConfig } from "./config.js";
import { HealthTracker } from "./health.js";
import { ToolRegistry } from "./tools/registry.js";
import {
  makeReadFileTool,
  makeWriteFileTool,
  makeEditFileTool,
  makeListDirTool,
  makeBashTool,
} from "./tools/filesystem.js";

const ESC = "\u001b";
const CURSOR_HIDE = `${ESC}[?25l`;
const CURSOR_SHOW = `${ESC}[?25h`;
const ALT_SCREEN = `${ESC}[?1049h`;
const ALT_SCREEN_OFF = `${ESC}[?1049l`;
const CLEAR = `${ESC}[2J${ESC}[H`;
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const ITALIC = `${ESC}[3m`;
const UNDERLINE = `${ESC}[4m`;

const FG = {
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  white: `${ESC}[37m`,
  gray: `${ESC}[90m`,
  brightRed: `${ESC}[91m`,
  brightGreen: `${ESC}[92m`,
  brightYellow: `${ESC}[93m`,
  brightCyan: `${ESC}[96m`,
};


const BG = {
  blue: `\u001b[44m`,
  darkGray: `\u001b[100m`,
};

const SPINNER = ['¦', '?', '?', '?', '?', '?'];

interface Msg {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export class TUI {
  readonly agent: Agent;
  readonly router: Router;
  readonly session: Session;
  readonly arena: Arena;

  private rl: readline.Interface;
  private isTty: boolean;
  private running = true;
  private messages: Msg[] = [];
  private inputLines: string[] = [""];
  private inputCursor = 0;
  private scrollOffset = 0;
  private spinnerIdx = 0;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private thinking = false;
  private arenaMode = false;
  private lastRenderHeight = 0;
  private resizeTimer: NodeJS.Timeout | null = null;

  constructor(opts: {
    agent: Agent;
    router: Router;
    session: Session;
    arena: Arena;
  }) {
    this.agent = opts.agent;
    this.router = opts.router;
    this.session = opts.session;
    this.arena = opts.arena;

    this.isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
      crlfDelay: Infinity,
    });

    for (const m of this.session.messages) {
      if (m.role === "system") continue;
      this.messages.push({ role: m.role as Msg["role"], content: m.content });
    }
  }

  showSystem(text: string): void {
    this.messages.push({ role: "system", content: text });
    this.render();
    if (!this.isTty) process.stdout.write(text + "\n");
  }

  exit(): void {
    this.running = false;
    this.cleanup();
    process.exit(0);
  }

  enterArena(): void {
    this.arenaMode = true;
    this.messages.push({
      role: "system",
      content:
        "Arena mode: type a prompt to compare models side-by-side. /arena exit to return to chat.",
    });
    this.render();
  }

  exitArena(): void {
    this.arenaMode = false;
    this.messages.push({ role: "system", content: "Returned to chat mode." });
    this.render();
  }

  start(): void {
    if (!this.isTty) {
      this.runNonTty();
      return;
    }
    this.initTty();
    this.render();
    this.bindKeys();
    this.prompt();
  }

  private initTty(): void {
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdout.write(CURSOR_HIDE);
    process.stdout.write(ALT_SCREEN);
    process.stdin.on("resize", () => this.scheduleResize());
  }

  private scheduleResize(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.scrollOffset = 0;
      this.render();
    }, 100);
  }

  private cleanup(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    process.stdout.write(CURSOR_SHOW);
    process.stdout.write(ALT_SCREEN_OFF);
    process.stdout.write(RESET);
    this.rl.close();
  }

  private runNonTty(): void {
    this.thinking = false;
    this.rl.on("line", async (line: string) => {
      await this.handleLine(line);
    });
    this.rl.on("close", () => {
      this.running = false;
    });
  }

  private prompt(): void {
    if (!this.isTty) return;
    this.render();
  }

  private bindKeys(): void {
    process.stdin.on("data", (data: Buffer) => {
      this.handleRawInput(data.toString("utf8"));
    });
  }

  private termWidth(): number {
    return process.stdout.columns || 80;
  }

  private termHeight(): number {
    return process.stdout.rows || 24;
  }

  private wrap(text: string, width: number): string[] {
    const lines: string[] = [];
    for (const para of text.split("\n")) {
      if (para.length === 0) {
        lines.push("");
        continue;
      }
      let start = 0;
      while (start < para.length) {
        const chunk = para.slice(start, start + width);
        lines.push(chunk);
        start += width;
      }
    }
    return lines;
  }

  private renderMessage(m: Msg, width: number): string[] {
    const color =
      m.role === "user"
        ? FG.brightCyan
        : m.role === "assistant"
          ? FG.brightGreen
          : m.role === "tool"
            ? FG.gray
            : FG.brightYellow;
    const label =
      m.role === "user"
        ? "You"
        : m.role === "assistant"
          ? "Assistant"
          : m.role === "tool"
            ? "Tool"
            : "System";
    const out: string[] = [];
    out.push(`${color}${label}${RESET}`);
    const body = this.wrap(m.content, width - 2);
    for (const line of body) {
      out.push(`${DIM}${line}${RESET}`);
    }
    return out;
  }

  private banner(): string {
    const provider = this.router.getActiveProvider() ?? "auto";
    const model = this.router.getActiveModel() ?? "(default)";
    const mode = this.arenaMode ? "ARENA" : "CHAT";
    const line = `aether  |  ${mode}  |  ${provider}  |  ${model}`;
    const pad = Math.max(0, this.termWidth() - line.length);
    return `${BG.blue}${FG.white}${BOLD} ${line}${" ".repeat(pad)} ${RESET}`;
  }

  private render(): void {
    if (!this.isTty) return;
    const width = this.termWidth();
    const height = this.termHeight();

    const rendered: string[] = [];
    rendered.push(this.banner());
    rendered.push(`${FG.gray}${"-".repeat(width)}${RESET}`);

    const bodyWidth = width - 2;
    const allLines: string[] = [];
    const start = Math.max(0, this.messages.length - 60);
    for (let i = start; i < this.messages.length; i++) {
      allLines.push(...this.renderMessage(this.messages[i], bodyWidth));
    }

    // Apply scroll offset (scroll down to newest by default).
    const maxScroll = Math.max(0, allLines.length - (height - 10));
    if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;
    const visible = allLines.slice(this.scrollOffset, this.scrollOffset + height - 10);

    for (const line of visible) {
      rendered.push(` ${line}`);
    }

    while (rendered.length < height - 4) {
      rendered.push("");
    }

    if (this.thinking) {
      const sp = SPINNER[this.spinnerIdx % SPINNER.length];
      rendered.push(`${FG.brightYellow}${sp} thinking...${RESET}`);
    }

    // Input box.
    rendered.push(`${FG.gray}${"-".repeat(width)}${RESET}`);
    const inputText = this.inputLines.join("\n");
    const inputDisplay = this.wrap(inputText || "", width - 4);
    if (inputDisplay.length === 0) inputDisplay.push("");
    for (const line of inputDisplay) {
      rendered.push(` ${FG.brightCyan}${line}${RESET}`);
    }
    rendered.push(`${FG.brightCyan}> ${RESET}`);

    process.stdout.write(CLEAR);
    process.stdout.write(rendered.join("\n"));
    this.lastRenderHeight = rendered.length;
  }

  private scrollUp(n = 1): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - n);
    this.render();
  }

  private scrollDown(n = 1): void {
    this.scrollOffset += n;
    this.render();
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.thinking = true;
    this.spinnerIdx = 0;
    this.spinnerTimer = setInterval(() => {
      this.spinnerIdx++;
      this.render();
    }, 120);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    this.thinking = false;
  }
  private handleRawInput(s: string): void {
    if (s === "\u0003") {
      // Ctrl+C: clear input
      this.inputLines = [""];
      this.inputCursor = 0;
      this.render();
      return;
    }
    if (s === "\u001b") {
      // Esc: clear input line
      this.inputLines = [""];
      this.inputCursor = 0;
      this.render();
      return;
    }
    if (s === "\u001b[A") {
      this.scrollUp(2);
      return;
    }
    if (s === "\u001b[B") {
      this.scrollDown(2);
      return;
    }
    if (s === "\u001b[C") {
      // right arrow: noop for now
      return;
    }
    if (s === "\u001b[D") {
      return;
    }
    if (s === "\u000c") {
      // Ctrl+L: redraw
      this.render();
      return;
    }
    if (s === "\u0004") {
      // Ctrl+D: exit
      this.exit();
      return;
    }
    if (s === "\r" || s === "\n") {
      this.submitLine();
      return;
    }
    if (s === "\u0008" || s === "\u007f") {
      // backspace
      this.backspace();
      return;
    }
    if (s === "\t") {
      this.cycleProvider();
      return;
    }
    if (s === "\u001b\r" || s === "\u001b\n") {
      // Alt+Enter: newline
      this.insertText("\n");
      return;
    }
    if (s.length === 1 && s >= " ") {
      this.insertText(s);
      return;
    }
    this.render();
  }

  private insertText(s: string): void {
    const line = this.inputLines[this.inputLines.length - 1] ?? "";
    this.inputLines[this.inputLines.length - 1] = line + s;
    this.inputCursor++;
  }

  private backspace(): void {
    const last = this.inputLines.length - 1;
    const line = this.inputLines[last] ?? "";
    if (line.length > 0) {
      this.inputLines[last] = line.slice(0, -1);
    } else if (this.inputLines.length > 1) {
      this.inputLines.pop();
    }
  }

  private submitLine(): void {
    const text = this.inputLines.join("\n").trim();
    this.inputLines = [""];
    this.inputCursor = 0;
    if (!text) return;
    void this.handleInput(text);
  }

  private cycleProvider(): void {
    const names = this.router.getProviderNames();
    if (names.length === 0) {
      this.showSystem("No providers available.");
      return;
    }
    const current = this.router.getActiveProvider();
    const idx = current ? names.indexOf(current) : -1;
    const next = names[(idx + 1) % names.length];
    this.router.setActiveProvider(next);
    this.showSystem(`Provider: ${next}`);
  }

  private async handleInput(text: string): Promise<void> {
    if (text.startsWith("/")) {
      await this.handleCommand(text);
      return;
    }

    if (this.arenaMode) {
      await this.runArena(text);
      return;
    }

    this.messages.push({ role: "user", content: text });
    this.session.add({ role: "user", content: text });
    this.scrollOffset = 0;
    this.render();
    this.startSpinner();

    const history = this.session.messages.filter(
      (m): m is Message => m.role !== "system"
    );

    let assistantText = "";
    let toolCalls: any[] = [];
    try {
      for await (const chunk of this.agent.run(text, history)) {
        this.handleStreamChunk(chunk, { assistantText, toolCalls });
      }
    } catch (err) {
      const msg = (err as Error).message;
      this.messages.push({ role: "system", content: `[error] ${msg}` });
    } finally {
      this.stopSpinner();
    }

    const finalText = assistantText;
    if (finalText.trim()) {
      this.messages.push({ role: "assistant", content: finalText });
      this.session.add({ role: "assistant", content: finalText, tool_calls: toolCalls.length ? toolCalls : undefined });
    }
    this.scrollOffset = 0;
    this.render();
  }

  private handleStreamChunk(
    chunk: ChatChunk,
    state: { assistantText: string; toolCalls: any[] }
  ): void {
    if (chunk.type === "text" && chunk.text) {
      state.assistantText += chunk.text;
      this.messages.push({ role: "assistant", content: chunk.text });
    } else if (chunk.type === "tool_call" && chunk.tool_call) {
      state.toolCalls.push(chunk.tool_call);
      const name = chunk.tool_call.function.name;
      this.messages.push({
        role: "tool",
        content: `[Tool: ${name}]`,
      });
    } else if (chunk.type === "error" && chunk.error) {
      this.messages.push({ role: "system", content: `[error] ${chunk.error}` });
    }
    this.render();
  }

  private async runArena(text: string): Promise<void> {
    this.messages.push({ role: "user", content: text });
    this.session.add({ role: "user", content: text });
    this.scrollOffset = 0;
    this.render();
    this.startSpinner();

    const history = this.session.messages.filter(
      (m): m is Message => m.role !== "system"
    );
    const modelIds = this.allModelIds();
    if (modelIds.length < 2) {
      this.stopSpinner();
      this.showSystem(
        `Arena needs at least 2 models. Found: ${modelIds.join(", ") || "(none)"}`
      );
      return;
    }

    const results: ArenaResult[] = await this.arena.compare(
      text,
      history,
      modelIds,
      (modelId, chunk) => {
        if (chunk.type === "text" && chunk.text) {
          this.messages.push({
            role: "system",
            content: `${FG.brightCyan}[${modelId}]${RESET} ${chunk.text}`,
          });
          this.render();
        }
      }
    );
    this.stopSpinner();

    this.messages.push({ role: "system", content: this.arena.render(results) });
    this.render();
  }

  private allModelIds(): string[] {
    const ids = new Set<string>();
    for (const cfg of this.router.configs) {
      if (!cfg.enabled) continue;
      for (const m of cfg.models) ids.add(m);
    }
    return Array.from(ids);
  }

  async handleCommand(text: string): Promise<void> {
    const { command, args } = parseCommand(text);
    if (!command) return;

    const ctx: CommandContext = {
      tui: this,
      agent: this.agent,
      router: this.router,
      session: this.session,
      arena: this.arena,
    };

    const handler = CommandHandler[command];
    if (!handler) {
      this.showSystem(`Unknown command: /${command}. Type /help for available commands.`);
      return;
    }

    try {
      const result = handler.run(args, ctx);
      if (typeof result === "string") {
        this.showSystem(result);
      } else if (result) {
        await result;
      }
    } catch (err) {
      this.showSystem(`Command error: ${(err as Error).message}`);
    }
  }
  private async handleLine(line: string): Promise<void> {
    const text = line.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      await this.handleCommand(text);
      return;
    }
    if (this.arenaMode) {
      await this.runArena(text);
      return;
    }

    this.messages.push({ role: "user", content: text });
    this.session.add({ role: "user", content: text });

    let assistantText = "";
    const history = this.session.messages.filter(
      (m): m is Message => m.role !== "system"
    );
    try {
      for await (const chunk of this.agent.run(text, history)) {
        if (chunk.type === "text" && chunk.text) {
          assistantText += chunk.text;
          process.stdout.write(chunk.text);
        } else if (chunk.type === "tool_call" && chunk.tool_call) {
          process.stdout.write(`\n[Tool: ${chunk.tool_call.function.name}]\n`);
        } else if (chunk.type === "error" && chunk.error) {
          process.stderr.write(`[error] ${chunk.error}\n`);
        }
      }
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
    }

    if (assistantText.trim()) {
      this.messages.push({ role: "assistant", content: assistantText });
      this.session.add({ role: "assistant", content: assistantText });
    }
    process.stdout.write("\n");
  }
}

export function createTUI(opts: {
  agent: Agent;
  router: Router;
  session: Session;
  arena: Arena;
}): TUI {
  return new TUI(opts);
}

export async function runTUI(): Promise<void> {
  const cfg = getConfig();
  const router = new Router(cfg.providers, new HealthTracker());
  const registry = new ToolRegistry();
  for (const make of [makeReadFileTool, makeWriteFileTool, makeEditFileTool, makeListDirTool, makeBashTool]) {
    const tool = make(process.cwd());
    registry.register(tool.def, tool.execute);
  }
  const agent = new Agent(router, registry);
  const session = new Session();
  const arena = new Arena(router);
  const tui = new TUI({ agent, router, session, arena });
  tui.start();
}
