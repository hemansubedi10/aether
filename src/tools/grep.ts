import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolDef } from "../types.js";

export interface ToolFactory {
  def: ToolDef;
  execute: (args: Record<string, any>) => Promise<string>;
}

const MAX_RESULTS = 5000;
const MAX_LINE_CHARS = 5000;

function matchesInclude(name: string, include: string): boolean {
  if (!include) return true;
  const patterns = include.split(",").map((s) => s.trim()).filter(Boolean);
  for (const pat of patterns) {
    if (matchGlob(pat, name)) return true;
  }
  return false;
}

function matchGlob(pattern: string, value: string): boolean {
  const re = globToRegex(pattern);
  return re.test(value);
}

function globToRegex(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 2;
        continue;
      }
      re += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      re += "[^/]";
      i += 1;
      continue;
    }
    if (ch === "[") {
      let j = i + 1;
      if (j < pattern.length && pattern[j] === "!") j++;
      if (j < pattern.length && pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") j++;
      if (j >= pattern.length) {
        re += "\\[";
        i += 1;
        continue;
      }
      let cls = pattern.slice(i + 1, j);
      if (cls.startsWith("!")) cls = "^" + cls.slice(1);
      re += "[" + cls + "]";
      i = j + 1;
      continue;
    }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  return new RegExp("^" + re + "$");
}

function isBinary(buf: Buffer): boolean {
  // Detect null bytes (common in binary files).
  for (let i = 0; i < Math.min(buf.length, 4096); i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function* walkFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkFiles(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

export function makeGrepTool(rootDir: string): ToolFactory {
  return {
    def: {
      name: "Grep",
      description:
        "Search file contents for a regex pattern. Returns matching lines with file path and line number. Use include filter like *.ts.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "regex pattern",
          },
          path: {
            type: "string",
            default: ".",
            description: "dir or file to search",
          },
          include: {
            type: "string",
            default: "",
            description: "file filter e.g. *.ts",
          },
          maxResults: {
            type: "number",
            default: 50,
          },
        },
        required: ["pattern"],
      },
    },
    execute: async (args) => {
      const pattern = String(args.pattern ?? "");
      if (!pattern) {
        return "ERROR: pattern is required";
      }
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR: invalid regex: ${message}`;
      }

      const relPath = String(args.path ?? ".").trim() || ".";
      const target = path.resolve(rootDir, relPath);
      if (!target.startsWith(path.resolve(rootDir))) {
        return `ERROR: path "${relPath}" escapes the project root`;
      }
      const include = String(args.include ?? "");
      const maxResults = Math.max(1, Math.min(MAX_RESULTS, Number(args.maxResults) || 50));

      try {
        if (!fs.existsSync(target)) {
          return `ERROR: path not found: ${relPath}`;
        }

        const files: string[] = [];
        if (fs.statSync(target).isFile()) {
          files.push(target);
        } else {
          for (const f of walkFiles(target)) {
            files.push(f);
          }
        }

        const matches: string[] = [];
        for (const full of files) {
          const rel = path.relative(rootDir, full).replace(/\\/g, "/");
          if (!matchesInclude(rel, include)) continue;
          try {
            const buf = fs.readFileSync(full);
            if (isBinary(buf)) continue;
            const text = buf.toString("utf8");
            const lines = text.split("\n");
            for (let ln = 1; ln <= lines.length; ln++) {
              if (matches.length >= maxResults) break;
              const line = lines[ln - 1];
              if (line.length > MAX_LINE_CHARS) continue;
              if (regex.test(line)) {
                matches.push(`${rel}:${ln}: ${line}`);
              }
            }
          } catch {
            // skip unreadable files
          }
          if (matches.length >= maxResults) break;
        }

        if (matches.length === 0) return "No matches";
        return matches.join("\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR grepping "${pattern}": ${message}`;
      }
    },
  };
}
