import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolDef } from "../types.js";

export interface ToolFactory {
  def: ToolDef;
  execute: (args: Record<string, any>) => Promise<string>;
}

const MAX_RESULTS = 5000;

/**
 * Match a single path segment against a glob segment.
 *  - `*`  matches any characters except `/`
 *  - `**` matches any number of path segments (including zero)
 *  - `?`  matches exactly one character except `/`
 *  - `[...]` character class
 */
function matchSegment(segment: string, value: string): boolean {
  if (segment === "**") return true;
  if (segment === value) return true;

  // Build a regex from the segment.
  let re = "";
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    if (ch === "*") {
      if (segment[i + 1] === "*") {
        // `**` within a segment means match anything including /
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
      if (j < segment.length && segment[j] === "!") j++;
      if (j < segment.length && segment[j] === "]") j++;
      while (j < segment.length && segment[j] !== "]") j++;
      if (j >= segment.length) {
        // No closing bracket - treat literally.
        re += "\\[";
        i += 1;
        continue;
      }
      let cls = segment.slice(i + 1, j);
      if (cls.startsWith("!")) cls = "^" + cls.slice(1);
      re += "[" + cls + "]";
      i = j + 1;
      continue;
    }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  return new RegExp("^" + re + "$").test(value);
}

function splitPattern(pattern: string): string[] {
  return pattern.replace(/\\/g, "/").replace(/^\.\//, "").split("/").filter((s) => s !== "");
}

function* walkMatches(
  segments: string[],
  prefix: string,
  cwd: string,
  depth: number
): Generator<string> {
  const seg = segments[depth];
  const isLast = depth === segments.length - 1;

  if (seg === "**") {
    // `**` matches the current directory and any depth below it.
    if (isLast) {
      yield prefix;
    }
    // Recurse into the current directory.
    yield* walkMatches(segments, prefix, cwd, depth + 1);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cwd, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const sub = path.join(cwd, e.name);
      const rel = prefix ? prefix + "/" + e.name : e.name;
      if (e.isDirectory()) {
        yield* walkMatches(segments, rel, sub, depth);
      } else if (isLast) {
        yield rel;
      }
    }
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cwd, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (!matchSegment(seg, e.name)) continue;
    const sub = path.join(cwd, e.name);
    const rel = prefix ? prefix + "/" + e.name : e.name;
    if (isLast) {
      yield rel;
    } else if (e.isDirectory()) {
      yield* walkMatches(segments, rel, sub, depth + 1);
    }
  }
}

export function makeGlobTool(rootDir: string): ToolFactory {
  return {
    def: {
      name: "Glob",
      description:
        "Find files matching a glob pattern (e.g. **/*.ts, src/*.js). Returns matching paths relative to project root, sorted.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "glob pattern like **/*.ts",
          },
          path: {
            type: "string",
            default: ".",
            description: "root dir to search",
          },
        },
        required: ["pattern"],
      },
    },
    execute: async (args) => {
      const pattern = String(args.pattern ?? "").trim();
      if (!pattern) {
        return "ERROR: pattern is required";
      }
      const relRoot = String(args.path ?? ".").trim() || ".";
      const target = path.resolve(rootDir, relRoot);
      if (!target.startsWith(path.resolve(rootDir))) {
        return `ERROR: path "${relRoot}" escapes the project root`;
      }
      try {
        if (!fs.existsSync(target)) {
          return `ERROR: path not found: ${relRoot}`;
        }
        const segments = splitPattern(pattern);
        if (segments.length === 0) {
          return "ERROR: empty pattern";
        }
        const results: string[] = [];
        for (const match of walkMatches(segments, "", target, 0)) {
          results.push(match);
          if (results.length >= MAX_RESULTS) break;
        }
        results.sort();
        if (results.length === 0) return "No matches";
        return results.join("\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR globbing "${pattern}": ${message}`;
      }
    },
  };
}
