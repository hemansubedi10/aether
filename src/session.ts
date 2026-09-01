import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Message } from "./types.js";
import { compressHistory } from "./tokensaver.js";

const DEFAULT_SESSION_DIR = path.join(os.homedir(), ".aether", "sessions");

export interface SessionData {
  version: number;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export class Session {
  messages: Message[] = [];
  createdAt: number = Date.now();
  updatedAt: number = Date.now();

  add(m: Message): void {
    this.messages.push(m);
    this.updatedAt = Date.now();
  }

  clear(): void {
    this.messages = [];
    this.updatedAt = Date.now();
  }

  get size(): number {
    return this.messages.length;
  }

  toJSON(): SessionData {
    return {
      version: 1,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      messages: this.messages,
    };
  }

  fromJSON(obj: SessionData): Session {
    this.messages = obj.messages ?? [];
    this.createdAt = obj.createdAt ?? Date.now();
    this.updatedAt = obj.updatedAt ?? Date.now();
    return this;
  }

  summarizeOld(router: any, keepRecent: number = 6): Message[] {
    // Keep the most recent messages and compress older ones via tokensaver.
    // If a router is available, a weak model could be asked to summarize the
    // dropped tail; we keep it simple and fall back to compressHistory.
    if (this.messages.length <= keepRecent) {
      return this.messages.slice();
    }
    const recent = this.messages.slice(-keepRecent);
    const older = this.messages.slice(0, -keepRecent);
    const compressed = compressHistory(older, 4096);
    return [...compressed, ...recent];
  }

  static load(filePath: string): Session {
    const session = new Session();
    try {
      if (!fs.existsSync(filePath)) return session;
      const raw = fs.readFileSync(filePath, "utf8");
      const obj = JSON.parse(raw);
      session.fromJSON(obj);
    } catch {
      // ignore malformed sessions
    }
    return session;
  }

  static save(filePath: string, session: Session): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(session.toJSON(), null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }

  static list(dir: string = DEFAULT_SESSION_DIR): Array<{ file: string; mtime: number; size: number }> {
    try {
      if (!fs.existsSync(dir)) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const out: Array<{ file: string; mtime: number; size: number }> = [];
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.endsWith(".json")) continue;
        const full = path.join(dir, e.name);
        try {
          const st = fs.statSync(full);
          out.push({ file: full, mtime: st.mtimeMs, size: st.size });
        } catch {
          // skip
        }
      }
      out.sort((a, b) => b.mtime - a.mtime);
      return out;
    } catch {
      return [];
    }
  }
}


