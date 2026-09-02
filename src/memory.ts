import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const MEMORY_DIR = path.join(os.homedir(), ".aether", "memory");

export class Memory {
  private facts: string[] = [];
  private dirty = false;

  constructor() {
    this.load();
  }

  static path(): string {
    return path.join(MEMORY_DIR, "MEMORY.md");
  }

  load(): void {
    this.facts = [];
    const file = Memory.path();
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, "utf8");
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("- ")) {
            const fact = trimmed.slice(2).trim();
            if (fact) this.facts.push(fact);
          }
        }
      }
    } catch {
      // ignore read errors; start with empty memory
    }
    this.dirty = false;
  }

  save(): void {
    try {
      if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
      }
      const lines = this.facts.map((f) => `- ${f}`);
      const content = lines.length ? lines.join("\n") + "\n" : "";
      const tmp = Memory.path() + ".tmp";
      fs.writeFileSync(tmp, content, "utf8");
      fs.renameSync(tmp, Memory.path());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to save memory: ${message}`);
    }
    this.dirty = false;
  }

  add(fact: string): void {
    const trimmed = fact.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    for (let i = 0; i < this.facts.length; i++) {
      if (this.facts[i].toLowerCase() === lower) {
        // Move to end (refresh).
        this.facts.splice(i, 1);
        this.facts.push(trimmed);
        this.dirty = true;
        return;
      }
    }
    this.facts.push(trimmed);
    this.dirty = true;
  }

  remove(fact: string): void {
    const trimmed = fact.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const before = this.facts.length;
    this.facts = this.facts.filter((f) => f.toLowerCase() !== lower);
    if (this.facts.length !== before) this.dirty = true;
  }

  search(query: string): string[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.facts.filter((f) => f.toLowerCase().includes(q));
  }

  getAll(): string[] {
    return this.facts.slice();
  }

  toContext(): string {
    if (this.facts.length === 0) return "";
    const lines = this.facts.map((f) => `- ${f}`);
    return "## Long-term Memory\n" + lines.join("\n");
  }

  ensureSaved(): void {
    if (this.dirty) this.save();
  }
}
