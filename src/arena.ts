import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ChatChunk, Message } from "./types.js";

const ARENA_FILE = path.join(os.homedir(), ".aether", "arena.json");
const ARENA_DIR = path.dirname(ARENA_FILE);
const LEADERBOARD_JSON = path.join(ARENA_DIR, "leaderboard.json");
const LEADERBOARD_MD = path.join(ARENA_DIR, "leaderboard.md");

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

export interface TournamentSummary {
  prompt: string;
  matches: number;
  rankings: RankingEntry[];
  judge: string;
  results: ArenaResult[];
}

export interface JudgeScore {
  overall: number;
  correctness: number;
  clarity: number;
  completeness: number;
  helpfulness: number;
}

export interface JudgeVerdict {
  scores: { modelA: JudgeScore; modelB: JudgeScore };
  winner: "modelA" | "modelB" | "tie";
  reasoning: string;
}

export interface HeadToHead {
  winsA: number;
  winsB: number;
  ties: number;
  total: number;
}

const K_FACTOR = 32;

export class Arena {
  readonly router: any;
  elo = new Map<string, number>();
  wins = new Map<string, number>();
  losses = new Map<string, number>();
  headToHead = new Map<string, { winsA: number; winsB: number; ties: number; total: number }>();

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

    const cols = results.map((r) => ({
      modelId: r.modelId,
      text: r.error ? `⚠ ${r.text}` : r.text,
      error: r.error,
      elapsedMs: r.elapsedMs,
    }));

    const width = Math.max(20, ...cols.map((c) => c.modelId.length + 4));

    const truncate = (s: string, max: number): string => {
      if (s.length <= max) return s;
      return s.slice(0, max - 1) + "\u2026";
    };

    const header = cols
      .map((c) => truncate(c.modelId, width))
      .join(" \u2502 ");
    const sep = cols.map(() => "-".repeat(width)).join("-+-");

    const maxLen = Math.max(...cols.map((c) => c.text.split("\n").length));
    const body: string[] = [];
    for (let i = 0; i < maxLen; i++) {
      const row = cols
        .map((c) => {
          const src = c.text.split("\n")[i] ?? "";
          return truncate(src, width).padEnd(width);
        })
        .join(" \u2502 ");
      body.push(row);
    }

    const footer = cols
      .map((c) => `${truncate(c.modelId, width)}: ${(c.elapsedMs / 1000).toFixed(2)}s`)
      .join(" \u2502 ");

    const lines: string[] = [header, sep, ...body, "", footer];
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
        if (obj.headToHead && typeof obj.headToHead === "object") {
          for (const [k, v] of Object.entries(obj.headToHead)) {
            const h = v as any;
            this.headToHead.set(k, {
              winsA: Number(h.winsA) || 0,
              winsB: Number(h.winsB) || 0,
              ties: Number(h.ties) || 0,
              total: Number(h.total) || 0,
            });
          }
        }
      }
    } catch {
      // ignore malformed arena file
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(ARENA_DIR)) fs.mkdirSync(ARENA_DIR, { recursive: true });
      const tmp = ARENA_FILE + ".tmp";
      fs.writeFileSync(
        tmp,
        JSON.stringify(
          {
            elo: Object.fromEntries(this.elo),
            wins: Object.fromEntries(this.wins),
            losses: Object.fromEntries(this.losses),
            headToHead: Object.fromEntries(this.headToHead),
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

  // ---------------------------------------------------------------------------
  // Head-to-head
  // ---------------------------------------------------------------------------

  /** Track direct confrontations between two specific models. */
  h2h(modelA: string, modelB: string): HeadToHead {
    const key = this.h2hKey(modelA, modelB);
    const raw = this.headToHead.get(key);
    if (raw) return { ...raw };
    return { winsA: 0, winsB: 0, ties: 0, total: 0 };
  }

  private h2hKey(modelA: string, modelB: string): string {
    return `${modelA}::${modelB}`;
  }

  private recordH2H(modelA: string, modelB: string, winner: "A" | "B" | "tie"): void {
    const key = this.h2hKey(modelA, modelB);
    const cur = this.headToHead.get(key) ?? { winsA: 0, winsB: 0, ties: 0, total: 0 };
    cur.total += 1;
    if (winner === "A") cur.winsA += 1;
    else if (winner === "B") cur.winsB += 1;
    else cur.ties += 1;
    this.headToHead.set(key, cur);
  }

  // ---------------------------------------------------------------------------
  // Leaderboard export
  // ---------------------------------------------------------------------------

  /** Export all elo, wins, losses, and rankings as a JSON string. */
  exportJSON(): string {
    const rankings = this.getRankings();
    const payload = {
      generatedAt: Date.now(),
      rankings: rankings.map((r) => ({
        modelId: r.modelId,
        elo: r.elo,
        wins: r.wins,
        losses: r.losses,
        winRate: r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0,
      })),
      elo: Object.fromEntries(this.elo),
      wins: Object.fromEntries(this.wins),
      losses: Object.fromEntries(this.losses),
      headToHead: Object.fromEntries(this.headToHead),
    };
    return JSON.stringify(payload, null, 2);
  }

  /** Export the leaderboard as a markdown table. */
  exportMarkdown(): string {
    const rankings = this.getRankings();
    if (rankings.length === 0) {
      return "| Rank | Model | Elo | Wins | Losses | Winrate |\n|------|-------|-----|------|--------|--------|\n";
    }
    const lines: string[] = [];
    lines.push("| Rank | Model | Elo | Wins | Losses | Winrate |");
    lines.push("|------|-------|-----|------|--------|--------|");
    rankings.forEach((r, i) => {
      const total = r.wins + r.losses;
      const winrate = total > 0 ? (r.wins / total) * 100 : 0;
      lines.push(`| ${i + 1} | ${r.modelId} | ${r.elo} | ${r.wins} | ${r.losses} | ${winrate.toFixed(1)}% |`);
    });
    return lines.join("\n");
  }

  /** Write the leaderboard to disk in the requested format. */
  saveLeaderboard(format: "json" | "md"): void {
    try {
      if (!fs.existsSync(ARENA_DIR)) fs.mkdirSync(ARENA_DIR, { recursive: true });
      const target = format === "json" ? LEADERBOARD_JSON : LEADERBOARD_MD;
      const content = format === "json" ? this.exportJSON() : this.exportMarkdown();
      fs.writeFileSync(target, content, "utf8");
    } catch {
      // best-effort persistence
    }
  }

  /** Read the leaderboard back from disk. Returns null if missing/invalid. */
  static loadLeaderboard(): {
    rankings: RankingEntry[];
    elo: Record<string, number>;
    wins: Record<string, number>;
    losses: Record<string, number>;
  } | null {
    try {
      if (!fs.existsSync(LEADERBOARD_JSON)) return null;
      const raw = fs.readFileSync(LEADERBOARD_JSON, "utf8");
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      const rankings: RankingEntry[] = Array.isArray(obj.rankings)
        ? obj.rankings.map((r: any) => ({
            modelId: String(r.modelId),
            elo: Number(r.elo) || 0,
            wins: Number(r.wins) || 0,
            losses: Number(r.losses) || 0,
          }))
        : [];
      return {
        rankings,
        elo: (obj.elo && typeof obj.elo === "object") ? obj.elo : {},
        wins: (obj.wins && typeof obj.wins === "object") ? obj.wins : {},
        losses: (obj.losses && typeof obj.losses === "object") ? obj.losses : {},
      };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Judge
  // ---------------------------------------------------------------------------

  /**
   * Ask a judge model to score two responses on a 0-10 scale across criteria.
   * Returns structured JSON; falls back to a tie if the judge fails.
   */
  private async judgeMatch(
    prompt: string,
    responseA: string,
    responseB: string,
    modelA: string,
    modelB: string,
    judgeModel: string
  ): Promise<JudgeVerdict> {
    const judgePrompt = [
      "You are an impartial judge for an AI model arena.",
      "Score the two responses below on a 0-10 scale for each criterion.",
      "Criteria: correctness, clarity, completeness, helpfulness.",
      "Return ONLY valid JSON, no markdown fences, no prose.",
      "Schema:",
      "{",
      '  "scores": {',
      '    "modelA": { "overall": number, "correctness": number, "clarity": number, "completeness": number, "helpfulness": number },',
      '    "modelB": { "overall": number, "correctness": number, "clarity": number, "completeness": number, "helpfulness": number }',
      "  },",
      '  "winner": "modelA" | "modelB" | "tie",',
      '  "reasoning": "string"',
      "}",
      "",
      `Prompt: ${prompt}`,
      "",
      `Model A (${modelA}):`,
      responseA,
      "",
      `Model B (${modelB}):`,
      responseB,
    ].join("\n");

    const fallback: JudgeVerdict = {
      scores: {
        modelA: { overall: 5, correctness: 5, clarity: 5, completeness: 5, helpfulness: 5 },
        modelB: { overall: 5, correctness: 5, clarity: 5, completeness: 5, helpfulness: 5 },
      },
      winner: "tie",
      reasoning: "Judge unavailable; declared a tie.",
    };

    try {
      const provider = await this.router.getModelProvider(judgeModel);
      const messages: Message[] = [{ role: "user", content: judgePrompt }];
      let text = "";
      for await (const chunk of provider.chat(messages, [], { temperature: 0, maxTokens: 1024 })) {
        if (chunk.type === "text" && chunk.text) text += chunk.text;
        if (chunk.type === "error") throw new Error(chunk.error ?? "judge error");
      }
      return this.parseJudgeResponse(text, modelA, modelB);
    } catch {
      return fallback;
    }
  }

  private parseJudgeResponse(raw: string, modelA: string, modelB: string): JudgeVerdict {
    let cleaned = (raw ?? "").trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Judge returned no JSON object");
    }
    const jsonText = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object" || !parsed.scores) {
      throw new Error("Judge JSON missing scores");
    }
    const normalize = (s: any): JudgeScore => ({
      overall: this.clampScore(s?.overall),
      correctness: this.clampScore(s?.correctness),
      clarity: this.clampScore(s?.clarity),
      completeness: this.clampScore(s?.completeness),
      helpfulness: this.clampScore(s?.helpfulness),
    });
    const winnerRaw = String(parsed.winner ?? "tie").toLowerCase();
    let winner: JudgeVerdict["winner"];
    if (winnerRaw === "modela" || winnerRaw === "model_a" || winnerRaw === "a") winner = "modelA";
    else if (winnerRaw === "modelb" || winnerRaw === "model_b" || winnerRaw === "b") winner = "modelB";
    else winner = "tie";

    return {
      scores: {
        modelA: normalize(parsed.scores.modelA),
        modelB: normalize(parsed.scores.modelB),
      },
      winner,
      reasoning: String(parsed.reasoning ?? ""),
    };
  }

  private clampScore(v: unknown): number {
    const n = Number(v);
    if (!Number.isFinite(n)) return 5;
    return Math.max(0, Math.min(10, n));
  }

  // ---------------------------------------------------------------------------
  // Tournament
  // ---------------------------------------------------------------------------

  /**
   * Run a round-robin tournament: every model plays against every other model
   * on the same prompt. A judge model scores each pair of responses and the
   * winner is recorded via recordMatch. Returns ArenaResult[] plus a summary.
   */
  async tournament(
    userMessage: string,
    history: Message[],
    modelIds: string[],
    onResult?: (modelId: string, chunk: ChatChunk) => void
  ): Promise<{ results: ArenaResult[]; summary: TournamentSummary }> {
    const unique = Array.from(new Set(modelIds.filter((m) => m && m.trim())));
    if (unique.length < 2) {
      throw new Error("Tournament requires at least 2 distinct models");
    }

    const judgeModel = this.pickJudge(unique);

    // 1. Collect full responses for every model once.
    const responses = await this.compare(userMessage, history, unique, onResult ?? (() => {}));
    const byModel = new Map<string, ArenaResult>();
    for (const r of responses) byModel.set(r.modelId, r);

    // 2. Round-robin: every pair plays once.
    const results: ArenaResult[] = [];
    const pairScores = new Map<string, number>(); // modelId -> accumulated judge score
    for (const m of unique) pairScores.set(m, 0);

    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i];
        const b = unique[j];
        const ra = byModel.get(a)?.text ?? "";
        const rb = byModel.get(b)?.text ?? "";
        const verdict = await this.judgeMatch(userMessage, ra, rb, a, b, judgeModel);

        const scoreA = this.average(verdict.scores.modelA);
        const scoreB = this.average(verdict.scores.modelB);
        pairScores.set(a, (pairScores.get(a) ?? 0) + scoreA);
        pairScores.set(b, (pairScores.get(b) ?? 0) + scoreB);

        if (verdict.winner === "modelA") {
          this.recordMatch(a, b);
          this.recordH2H(a, b, "A");
        } else if (verdict.winner === "modelB") {
          this.recordMatch(b, a);
          this.recordH2H(a, b, "B");
        } else {
          this.recordH2H(a, b, "tie");
        }
        results.push(...responses.filter((r) => r.modelId === a || r.modelId === b));
      }
    }

    const rankings = this.getRankings().map((r) => ({
      ...r,
      elo: r.elo,
    }));
    // Sort by accumulated judge score, falling back to elo.
    const sorted = [...rankings].sort((x, y) => {
      const d = (pairScores.get(y.modelId) ?? 0) - (pairScores.get(x.modelId) ?? 0);
      if (d !== 0) return d;
      return y.elo - x.elo;
    });

    const summary: TournamentSummary = {
      prompt: userMessage,
      matches: unique.length * (unique.length - 1) / 2,
      rankings: sorted,
      judge: judgeModel,
      results,
    };
    return { results, summary };
  }

  private average(score: JudgeScore): number {
    return (score.overall + score.correctness + score.clarity + score.completeness + score.helpfulness) / 5;
  }

  private pickJudge(modelIds: string[]): string {
    // Strongest available = highest current elo, otherwise first model.
    let best = modelIds[0];
    let bestElo = -Infinity;
    for (const m of modelIds) {
      const e = this.elo.get(m) ?? 1200;
      if (e > bestElo) {
        bestElo = e;
        best = m;
      }
    }
    return best;
  }
}
