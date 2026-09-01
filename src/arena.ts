import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ChatChunk, Message } from "./types.js";

const ARENA_FILE = path.join(os.homedir(), ".aether", "arena.json");

export interface ArenaResult {
  modelId: string;
  text: string;
  toolCalls: any[];
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
  elapsedMs: number;
}

export interface RankingEntry {
  modelId: string;
  elo: number;
  wins: number;
  losses: number;
}

const K_FACTOR = 32;

export class Arena {
  readonly router: any;
  elo = new Map<string, number>();
  wins = new Map<string, number>();
  losses = new Map<string, number>();

  constructor(router: any) {
    this.router = router;
    this.load();
  }

  private ensure(modelId: string): void {
    if (!this.elo.has(modelId)) this.elo.set(modelId, 1200);
    if (!this.wins.has(modelId)) this.wins.set(modelId, 0);
    if (!this.losses.has(modelId)) this.losses.set(modelId, 0);
  }

  /** Run the same prompt through N models in parallel, streaming each result. */
  async compare(
    userMessage: string,
    history: Message[],
    modelIds: string[],
    onResult: (modelId: string, chunk: ChatChunk) => void
  ): Promise<ArenaResult[]> {
    const settled = await Promise.all(
      modelIds.map((modelId) => this.runOne(modelId, userMessage, history, onResult))
    );
    return settled.filter((r): r is ArenaResult => r !== null);
  }

  private async runOne(
    modelId: string,
    userMessage: string,
    history: Message[],
    onResult: (modelId: string, chunk: ChatChunk) => void
  ): Promise<ArenaResult | null> {
    const start = Date.now();
    let text = "";
    const toolCalls: any[] = [];
    let usage: ArenaResult["usage"];
    let error: string | undefined;
    try {
      const provider = await this.router.getModelProvider(modelId);
      const messages: Message[] = [...history, { role: "user", content: userMessage }];
      for await (const chunk of provider.chat(messages, [], { temperature: 0.7, maxTokens: 4096 })) {
        onResult(modelId, chunk);
        if (chunk.type === "text" && chunk.text) text += chunk.text;
        if (chunk.type === "tool_call" && chunk.tool_call) toolCalls.push(chunk.tool_call);
        if (chunk.type === "done") usage = chunk.usage;
        if (chunk.type === "error" && chunk.error) error = chunk.error;
      }
    } catch (err) {
      error = (err as Error).message;
    }
    return {
      modelId,
      text,
      toolCalls,
      usage,
      error,
      elapsedMs: Date.now() - start,
    };
  }

  /** Collect full responses from each model for blind voting. */
  async vote(
    userMessage: string,
    history: Message[],
    modelIds: string[]
  ): Promise<{ modelId: string; response: string }[]> {
    const results = await this.compare(userMessage, history, modelIds, () => {});
    return results.map((r) => ({ modelId: r.modelId, response: r.error ? `[error] ${r.error}` : r.text }));
  }

  recordMatch(winner: string, loser: string): void {
    this.ensure(winner);
    this.ensure(loser);
    const eW = this.elo.get(winner)!;
    const eL = this.elo.get(loser)!;
    const expectedW = 1 / (1 + Math.pow(10, (eL - eW) / 400));
    const expectedL = 1 - expectedW;
    this.elo.set(winner, Math.round(eW + K_FACTOR * (1 - expectedW)));
    this.elo.set(loser, Math.round(eL + K_FACTOR * (0 - expectedL)));
    this.wins.set(winner, (this.wins.get(winner) ?? 0) + 1);
    this.losses.set(loser, (this.losses.get(loser) ?? 0) + 1);
    this.save();
  }

  getRankings(): RankingEntry[] {
    const out: RankingEntry[] = [];
    for (const modelId of this.elo.keys()) {
      this.ensure(modelId);
      out.push({
        modelId,
        elo: this.elo.get(modelId)!,
        wins: this.wins.get(modelId)!,
        losses: this.losses.get(modelId)!,
      });
    }
    return out.sort((a, b) => b.elo - a.elo);
  }

  /** Render a side-by-side comparison string for display. */
  render(results: ArenaResult[]): string {
    if (results.length === 0) return "(no results)";
    const width = Math.max(24, ...results.map((r) => r.modelId.length + 4));
    const header = results
      .map((r) => r.modelId.padEnd(width))
      .join(" | ");
    const sep = results.map(() => "-".repeat(width)).join("-+-");
    const body = this.splitColumns(results, width);
    const lines: string[] = [header, sep];
    for (const row of body) {
      lines.push(row);
    }
    return lines.join("\n");
  }

  private splitColumns(results: ArenaResult[], width: number): string[] {
    const maxLen = Math.max(...results.map((r) => r.text.split("\n").length));
    const lines: string[] = [];
    for (let i = 0; i < maxLen; i++) {
      const cols = results.map((r) => {
        const src = r.text.split("\n")[i] ?? "";
        return (r.error ? `> ${src}` : src).padEnd(width);
      });
      lines.push(cols.join(" | "));
    }
    return lines;
  }

  private load(): void {
    try {
      if (!fs.existsSync(ARENA_FILE)) return;
      const raw = fs.readFileSync(ARENA_FILE, "utf8");
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        if (obj.elo && typeof obj.elo === "object") {
          for (const [k, v] of Object.entries(obj.elo)) this.elo.set(k, Number(v) || 1200);
        }
        if (obj.wins && typeof obj.wins === "object") {
          for (const [k, v] of Object.entries(obj.wins)) this.wins.set(k, Number(v) || 0);
        }
        if (obj.losses && typeof obj.losses === "object") {
          for (const [k, v] of Object.entries(obj.losses)) this.losses.set(k, Number(v) || 0);
        }
      }
    } catch {
      // ignore malformed arena file
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(ARENA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = ARENA_FILE + ".tmp";
      fs.writeFileSync(
        tmp,
        JSON.stringify(
          {
            elo: Object.fromEntries(this.elo),
            wins: Object.fromEntries(this.wins),
            losses: Object.fromEntries(this.losses),
          },
          null,
          2
        ),
        "utf8"
      );
      fs.renameSync(tmp, ARENA_FILE);
    } catch {
      // best-effort persistence
    }
  }
}