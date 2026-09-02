import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface CheckpointEntry {
  label: string;
  timestamp: number;
  files: { path: string; content: string }[];
}

export class Checkpoint {
  private dir: string;
  private index: Map<string, CheckpointEntry>;

  constructor(dir?: string) {
    this.dir = dir ?? path.join(os.homedir(), ".aether", "checkpoints");
    this.index = new Map();
    this.loadAll();
  }

  private get filePath(): { path: string; entries: CheckpointEntry[] } {
    return { path: path.join(this.dir, "index.json"), entries: [] };
  }

  private loadAll(): void {
    try {
      if (!fs.existsSync(this.dir)) return;
      const indexFile = path.join(this.dir, "index.json");
      if (!fs.existsSync(indexFile)) return;
      const raw = fs.readFileSync(indexFile, "utf8");
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const e of arr) this.index.set(e.label, e);
      }
    } catch {
      // ignore
    }
  }

  private saveIndex(): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const arr = Array.from(this.index.values());
      const tmp = path.join(this.dir, "index.json.tmp");
      fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), "utf8");
      fs.renameSync(tmp, path.join(this.dir, "index.json"));
    } catch {
      // best effort
    }
  }

  save(filePaths: string[], label: string): CheckpointEntry {
    const files: { path: string; content: string }[] = [];
    for (const fp of filePaths) {
      try {
        if (fs.existsSync(fp)) {
          files.push({ path: fp, content: fs.readFileSync(fp, "utf8") });
        }
      } catch {
        // skip unreadable files
      }
    }
    const entry: CheckpointEntry = { label, timestamp: Date.now(), files };
    this.index.set(label, entry);
    this.saveIndex();
    return entry;
  }

  restore(label: string): string {
    const entry = this.index.get(label);
    if (!entry) return `ERROR: no checkpoint named "${label}"`;
    let restored = 0;
    for (const f of entry.files) {
      try {
        const dir = path.dirname(f.path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(f.path, f.content, "utf8");
        restored++;
      } catch (err) {
        return `ERROR restoring ${f.path}: ${(err as Error).message}`;
      }
    }
    return `Restored ${restored} file(s) from checkpoint "${label}".`;
  }

  list(): { label: string; timestamp: number; fileCount: number }[] {
    return Array.from(this.index.values())
      .map((e) => ({ label: e.label, timestamp: e.timestamp, fileCount: e.files.length }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  latest(): CheckpointEntry | undefined {
    let latest: CheckpointEntry | undefined;
    for (const e of this.index.values()) {
      if (!latest || e.timestamp > latest.timestamp) latest = e;
    }
    return latest;
  }

  autoCheckpoint(rootDir: string, filePath: string): void {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(rootDir, filePath);
    const label = `auto-${Date.now()}`;
    this.save([abs], label);
  }

  private static instance_: Checkpoint | null = null;
  static instance(): Checkpoint {
    if (!Checkpoint.instance_) Checkpoint.instance_ = new Checkpoint();
    return Checkpoint.instance_;
  }
}
