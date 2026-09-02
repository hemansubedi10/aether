import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface GitFileStatus {
  file: string;
  status: string;
}

export interface GitCommit {
  hash: string;
  message: string;
  date: string;
}

export class GitTool {
  static isRepo(rootDir: string): boolean {
    try {
      cp.execSync("git rev-parse --is-inside-work-tree", { cwd: rootDir, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  static async status(rootDir: string): Promise<GitFileStatus[]> {
    const out = cp.execSync("git status --short", { cwd: rootDir, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    const results: GitFileStatus[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const status = line.slice(0, 2).trim();
      const file = line.slice(3).trim();
      results.push({ file, status });
    }
    return results;
  }

  static async diff(rootDir: string, file?: string): Promise<string> {
    const args = file ? `-- "${file}"` : "";
    return cp.execSync(`git diff ${args}`, { cwd: rootDir, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  }

  static async commit(rootDir: string, message: string): Promise<string> {
    if (!message || message.trim().length === 0) {
      throw new Error("Commit message is required");
    }
    if (message.includes("\n") || message.includes("'") || message.includes('"')) {
      throw new Error("Commit message must be a single line without quotes");
    }
    return cp.execSync(`git commit -am "${message.replace(/"/g, "")}"`, { cwd: rootDir, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  }

  static async branch(rootDir: string): Promise<string> {
    return cp.execSync("git rev-parse --abbrev-ref HEAD", { cwd: rootDir, encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();
  }

  static async log(rootDir: string, count = 5): Promise<GitCommit[]> {
    const fmt = "%H%x1f%s%x1f%ci";
    const out = cp.execSync(`git log -n ${count} --format="${fmt}"`, { cwd: rootDir, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    const commits: GitCommit[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const [hash, message, date] = line.split("\x1f");
      commits.push({ hash: hash.slice(0, 7), message, date });
    }
    return commits;
  }
}
