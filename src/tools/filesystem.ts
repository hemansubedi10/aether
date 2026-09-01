import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { ToolDef } from "../types.js";

export interface ToolFactory {
  def: ToolDef;
  execute: (args: Record<string, any>) => Promise<string>;
}

const MAX_READ_CHARS = 50_000;
const MAX_OUTPUT_CHARS = 30_000;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return (
    s.slice(0, max) +
    `\n\n[...truncated ${s.length - max} more characters...]\n`
  );
}

export function makeReadFileTool(rootDir: string): ToolFactory {
  return {
    def: {
      name: "ReadFile",
      description:
        "Read the contents of a file at a given relative path. Returns file contents.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "relative path from project root",
          },
        },
        required: ["path"],
      },
    },
    execute: async (args) => {
      const rel = String(args.path ?? "");
      const target = path.resolve(rootDir, rel);
      if (!target.startsWith(path.resolve(rootDir))) {
        return `ERROR: path "${rel}" escapes the project root`;
      }
      try {
        if (!fs.existsSync(target)) {
          return `ERROR: file not found: ${rel}`;
        }
        if (fs.statSync(target).isDirectory()) {
          return `ERROR: path "${rel}" is a directory, not a file`;
        }
        const content = fs.readFileSync(target, "utf8");
        return truncate(content, MAX_READ_CHARS);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR reading "${rel}": ${message}`;
      }
    },
  };
}

export function makeWriteFileTool(rootDir: string): ToolFactory {
  return {
    def: {
      name: "WriteFile",
      description:
        "Write content to a file, creating parent directories if needed. Returns confirmation.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
    execute: async (args) => {
      const rel = String(args.path ?? "");
      const content = String(args.content ?? "");
      const target = path.resolve(rootDir, rel);
      if (!target.startsWith(path.resolve(rootDir))) {
        return `ERROR: path "${rel}" escapes the project root`;
      }
      try {
        const parent = path.dirname(target);
        fs.mkdirSync(parent, { recursive: true });
        fs.writeFileSync(target, content, "utf8");
        return `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${rel}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR writing "${rel}": ${message}`;
      }
    },
  };
}

export function makeEditFileTool(rootDir: string): ToolFactory {
  return {
    def: {
      name: "EditFile",
      description:
        "Replace exact text in a file. oldText must match exactly once. Returns confirmation.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
        },
        required: ["path", "oldText", "newText"],
      },
    },
    execute: async (args) => {
      const rel = String(args.path ?? "");
      const oldText = String(args.oldText ?? "");
      const newText = String(args.newText ?? "");
      const target = path.resolve(rootDir, rel);
      if (!target.startsWith(path.resolve(rootDir))) {
        return `ERROR: path "${rel}" escapes the project root`;
      }
      try {
        if (!fs.existsSync(target)) {
          return `ERROR: file not found: ${rel}`;
        }
        const original = fs.readFileSync(target, "utf8");
        const first = original.indexOf(oldText);
        if (first === -1) {
          return `ERROR: oldText not found in "${rel}". The file may have changed; read it first.`;
        }
        const second = original.indexOf(oldText, first + 1);
        if (second !== -1) {
          return `ERROR: oldText found multiple times in "${rel}". oldText must match exactly once.`;
        }
        const updated =
          original.slice(0, first) +
          newText +
          original.slice(first + oldText.length);
        fs.writeFileSync(target, updated, "utf8");
        return `Edited ${rel}: ${countLines(oldText)} old line(s) -> ${countLines(newText)} new line(s)`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR editing "${rel}": ${message}`;
      }
    },
  };
}

function countLines(s: string): number {
  if (s.length === 0) return 0;
  return s.split("\n").length;
}

export function makeListDirTool(rootDir: string): ToolFactory {
  return {
    def: {
      name: "ListDir",
      description:
        "List files and subdirectories at a path (recursive, like tree).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", default: "." },
        },
      },
    },
    execute: async (args) => {
      const rel = String(args.path ?? ".");
      const target = path.resolve(rootDir, rel);
      if (!target.startsWith(path.resolve(rootDir))) {
        return `ERROR: path "${rel}" escapes the project root`;
      }
      try {
        if (!fs.existsSync(target)) {
          return `ERROR: path not found: ${rel}`;
        }
        const lines: string[] = [];
        const rootLabel = rel === "." ? "." : rel;
        lines.push(rootLabel);
        walk(target, "", lines);
        return truncate(lines.join("\n"), MAX_OUTPUT_CHARS);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR listing "${rel}": ${message}`;
      }
    },
  };
}

function walk(dir: string, prefix: string, lines: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const filtered = entries.filter((e) => !e.name.startsWith("."));
  filtered.forEach((entry, i) => {
    const isLast = i === filtered.length - 1;
    const connector = isLast ? "+-- " : "+-- ";
    lines.push(`${prefix}${connector}${entry.name}`);
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name), prefix + (isLast ? "    " : "¦   "), lines);
    }
  });
}

export function makeBashTool(rootDir: string): ToolFactory {
  return {
    def: {
      name: "Bash",
      description:
        "Execute a shell command in the project directory. Returns stdout+stderr. Use for running commands, tests, installs. Prefer non-interactive commands.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "the shell command",
          },
          timeoutMs: { type: "number", default: 30000 },
        },
        required: ["command"],
      },
    },
    execute: async (args) => {
      const command = String(args.command ?? "");
      if (!command.trim()) {
        return "ERROR: empty command";
      }
      const timeoutMs = Math.max(
        1000,
        Math.min(600_000, Number(args.timeoutMs) || 30_000)
      );
      try {
        const stdout = execSync(command, {
          cwd: rootDir,
          maxBuffer: 10 * 1024 * 1024,
          timeout: timeoutMs,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return truncate(stdout, MAX_OUTPUT_CHARS);
      } catch (err: any) {
        const stderr = err?.stderr ? String(err.stderr) : "";
        const message = err?.message ? String(err.message) : String(err);
        const stdout = err?.stdout ? String(err.stdout) : "";
        return truncate(
          `ERROR: ${stderr || message}\nSTDOUT: ${stdout}`,
          MAX_OUTPUT_CHARS
        );
      }
    },
  };
}
