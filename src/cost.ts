import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface CostRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  cost: number;
}

interface CostSnapshot {
  version: number;
  records: Record<string, Omit<CostRecord, "provider" | "model">>;
}

// Per-token pricing in USD. Defaults are conservative estimates for free/cheap
// endpoints; callers may override via CostTracker.setPrice().
const DEFAULT_INPUT_PRICE: Record<string, number> = {
  "openrouter-free": 0,
  "openai-compatible": 0.000002,
  ollama: 0,
};

const DEFAULT_OUTPUT_PRICE: Record<string, number> = {
  "openrouter-free": 0,
  "openai-compatible": 0.000006,
  ollama: 0,
};

const COST_DIR = path.join(os.homedir(), ".aether");
const COST_FILE = path.join(COST_DIR, "cost.json");
const COST_VERSION = 1;

function key(provider: string, model: string): string {
  return `${provider}::${model}`;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

function formatUSD(value: number): string {
  if (!isFinite(value)) return "0.000000";
  if (Math.abs(value) < 1e-6 && value !== 0) return value.toExponential(3);
  return value.toFixed(6);
}

export class CostTracker {
  private records = new Map<string, CostRecord>();
  private inputPrice: Record<string, number> = { ...DEFAULT_INPUT_PRICE };
  private outputPrice: Record<string, number> = { ...DEFAULT_OUTPUT_PRICE };

  constructor() {}

  setPrice(provider: string, inputPerToken: number, outputPerToken: number): void {
    this.inputPrice[provider] = inputPerToken;
    this.outputPrice[provider] = outputPerToken;
  }

  record(provider: string, model: string, inputTokens: number, outputTokens: number): void {
    const k = key(provider, model);
    let r = this.records.get(k);
    if (!r) {
      r = { provider, model, inputTokens: 0, outputTokens: 0, requests: 0, cost: 0 };
      this.records.set(k, r);
    }
    const safeIn = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
    const safeOut = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
    r.inputTokens += safeIn;
    r.outputTokens += safeOut;
    r.requests += 1;
    const inPrice = this.inputPrice[provider] ?? DEFAULT_INPUT_PRICE[provider] ?? 0;
    const outPrice = this.outputPrice[provider] ?? DEFAULT_OUTPUT_PRICE[provider] ?? 0;
    r.cost += safeIn * inPrice + safeOut * outPrice;
  }

  private list(): CostRecord[] {
    return Array.from(this.records.values()).sort((a, b) => b.cost - a.cost);
  }

  getSummary(): CostRecord[] {
    return this.list();
  }

  getTotal(): number {
    let total = 0;
    for (const r of this.records.values()) total += r.cost;
    return total;
  }

  formatSummary(): string {
    const rows = this.list();
    const total = this.getTotal();

    const headers = ["Provider", "Model", "Requests", "Input Tok", "Output Tok", "Cost (USD)"];
    const data: string[][] = [];
    for (const r of rows) {
      data.push([
        r.provider,
        r.model,
        String(r.requests),
        String(r.inputTokens),
        String(r.outputTokens),
        formatUSD(r.cost),
      ]);
    }
    if (rows.length === 0) {
      data.push(["-", "-", "-", "-", "-", "-"]);
    }
    data.push(["", "", "", "", "Total", formatUSD(total)]);

    const widths: number[] = headers.map((h, i) => {
      let w = h.length;
      for (const row of data) {
        if (row[i] && row[i].length > w) w = row[i].length;
      }
      return w;
    });

    const lines: string[] = [];
    lines.push(headers.map((h, i) => pad(h, widths[i])).join("  "));
    lines.push(widths.map((w) => "-".repeat(w)).join("  "));
    for (const row of data) {
      lines.push(row.map((c, i) => pad(c, widths[i])).join("  "));
    }
    return lines.join("\n");
  }

  reset(): void {
    this.records.clear();
  }

  private snapshot(): CostSnapshot {
    const out: CostSnapshot["records"] = {};
    for (const [k, r] of this.records) {
      out[k] = {
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        requests: r.requests,
        cost: r.cost,
      };
    }
    return { version: COST_VERSION, records: out };
  }

  private restore(snapshot: CostSnapshot): void {
    this.records.clear();
    if (!snapshot || typeof snapshot !== "object") return;
    for (const [k, v] of Object.entries(snapshot.records ?? {})) {
      const parts = k.split("::");
      const provider = parts[0] ?? "";
      const model = parts.slice(1).join("::");
      const r: CostRecord = {
        provider,
        model,
        inputTokens: v?.inputTokens ?? 0,
        outputTokens: v?.outputTokens ?? 0,
        requests: v?.requests ?? 0,
        cost: v?.cost ?? 0,
      };
      this.records.set(k, r);
    }
  }

  static load(): CostTracker {
    const tracker = new CostTracker();
    try {
      if (fs.existsSync(COST_FILE)) {
        const raw = fs.readFileSync(COST_FILE, "utf8");
        const parsed = JSON.parse(raw);
        tracker.restore(parsed);
      }
    } catch {
      // ignore malformed cost file
    }
    return tracker;
  }

  static save(tracker: CostTracker): void {
    try {
      if (!fs.existsSync(COST_DIR)) {
        fs.mkdirSync(COST_DIR, { recursive: true });
      }
      const tmp = COST_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(tracker.snapshot(), null, 2), "utf8");
      fs.renameSync(tmp, COST_FILE);
    } catch {
      // best-effort persistence
    }
  }

  private static instanceCache = new Map<string, CostTracker>();

  static instance(name: string = "default"): CostTracker {
    let t = CostTracker.instanceCache.get(name);
    if (!t) {
      t = name === "default" ? CostTracker.load() : new CostTracker();
      CostTracker.instanceCache.set(name, t);
    }
    return t;
  }
}
